#!/usr/bin/env node
/**
 * Check Google Maps Platform (and related) API quota usage via Cloud Monitoring.
 *
 * Reads consumer-quota time series (usage vs limit) and prints approximate % used / % remaining.
 *
 * Prerequisites:
 *   - GCP project with Maps APIs enabled and billing linked (same project as API key restrictions, if any)
 *   - Service account JSON with role: Monitoring Viewer (roles/monitoring.viewer) or broader
 *   - Enable "Cloud Monitoring API" on the project
 *
 * Environment:
 *   GOOGLE_CLOUD_PROJECT or GCP_PROJECT  — GCP project ID (required)
 *   GOOGLE_APPLICATION_CREDENTIALS       — path to service account JSON (required for non-gcloud auth)
 *
 * Optional:
 *   MAP_QUOTA_SERVICES — comma-separated resource.label.service values to include
 *                        (default: common Maps backend service names)
 *   GOOGLE_QUOTA_LOOKBACK_DAYS — default 7
 *
 * Usage:
 *   node scripts/check-google-api-quota.js
 *   node scripts/check-google-api-quota.js --json
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { GoogleAuth } = require('google-auth-library');

const DEFAULT_MAPS_SERVICES = [
  'maps-backend.googleapis.com',
  'geocoding-backend.googleapis.com',
  'directions-backend.googleapis.com',
  'distance-matrix-backend.googleapis.com',
  'places-backend.googleapis.com',
  'routes.googleapis.com',
  'roads.googleapis.com',
  'static-maps-backend.googleapis.com',
  'geolocation.googleapis.com',
  'maps-android-backend.googleapis.com',
  'maps-ios-backend.googleapis.com',
];

function parseArgs() {
  const json = process.argv.includes('--json');
  return { json };
}

function parseServiceList() {
  const raw = process.env.MAP_QUOTA_SERVICES;
  if (raw && String(raw).trim()) {
    return String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return DEFAULT_MAPS_SERVICES;
}

function buildServiceFilter(services) {
  if (!services.length) return '';
  return services.map((s) => `resource.label.service="${s}"`).join(' OR ');
}

function getProjectId() {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    ''
  ).trim();
}

function pointValue(point) {
  const v = point?.value;
  if (!v) return null;
  if (v.int64Value !== undefined && v.int64Value !== null) return Number(v.int64Value);
  if (v.doubleValue !== undefined && v.doubleValue !== null) return Number(v.doubleValue);
  if (v.boolValue !== undefined) return v.boolValue ? 1 : 0;
  return null;
}

function latestPointValue(ts) {
  const points = ts.points || [];
  if (!points.length) return null;
  return pointValue(points[0]);
}

function seriesKey(ts, kind) {
  const svc = ts.resource?.labels?.service || '';
  const qm = ts.metric?.labels?.quota_metric || '';
  const ln = ts.metric?.labels?.limit_name || '';
  const loc = ts.resource?.labels?.location || '';
  return `${kind}|${svc}|${qm}|${ln}|${loc}`;
}

async function fetchAllTimeSeries(projectId, filter, accessToken) {
  const lookbackDays = Math.min(30, Math.max(1, Number(process.env.GOOGLE_QUOTA_LOOKBACK_DAYS || 7)));
  const end = new Date();
  const start = new Date(end.getTime() - lookbackDays * 86400000);
  const out = [];
  let pageToken = '';

  do {
    const url = new URL(
      `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries`
    );
    url.searchParams.set('filter', filter);
    url.searchParams.set('interval.endTime', end.toISOString());
    url.searchParams.set('interval.startTime', start.toISOString());
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = body.error?.message || body.message || res.statusText;
      const err = new Error(`Monitoring API ${res.status}: ${msg}`);
      err.details = body;
      throw err;
    }

    for (const ts of body.timeSeries || []) {
      out.push(ts);
    }
    pageToken = body.nextPageToken || '';
  } while (pageToken);

  return out;
}

function mergeUsageAndLimit(usageSeries, limitSeries) {
  const limits = new Map();
  for (const ts of limitSeries) {
    const key = seriesKey(ts, 'limit');
    const v = latestPointValue(ts);
    if (v != null) limits.set(key.replace('limit|', 'pair|'), v);
  }

  const rows = [];
  for (const ts of usageSeries) {
    const svc = ts.resource?.labels?.service || '';
    const qm = ts.metric?.labels?.quota_metric || '';
    const ln = ts.metric?.labels?.limit_name || '';
    const loc = ts.resource?.labels?.location || '';
    const pairKey = `pair|${svc}|${qm}|${ln}|${loc}`;
    const usage = latestPointValue(ts);
    const limit = limits.get(pairKey);

    rows.push({
      service: svc,
      quota_metric: qm,
      limit_name: ln || '(default)',
      location: loc || '—',
      usage: usage != null ? usage : null,
      limit: limit != null ? limit : null,
    });
  }

  return rows;
}

function attachLimitsByMetric(rows, limitSeries) {
  const byMetric = new Map();
  for (const ts of limitSeries) {
    const svc = ts.resource?.labels?.service || '';
    const qm = ts.metric?.labels?.quota_metric || '';
    const ln = ts.metric?.labels?.limit_name || '';
    const loc = ts.resource?.labels?.location || '';
    const v = latestPointValue(ts);
    const k = `${svc}\t${qm}\t${ln}\t${loc}`;
    if (v != null && !byMetric.has(k)) byMetric.set(k, v);
  }

  for (const r of rows) {
    if (r.limit != null) continue;
    const k = `${r.service}\t${r.quota_metric}\t${r.limit_name === '(default)' ? '' : r.limit_name}\t${r.location === '—' ? '' : r.location}`;
    if (byMetric.has(k)) r.limit = byMetric.get(k);
    const k2 = `${r.service}\t${r.quota_metric}\t\t${r.location === '—' ? '' : r.location}`;
    if (r.limit == null && byMetric.has(k2)) r.limit = byMetric.get(k2);
  }
  return rows;
}

function formatPct(used, limit) {
  if (limit == null || limit <= 0 || used == null) return { pctUsed: null, pctRemaining: null };
  const pctUsed = Math.min(100, (used / limit) * 100);
  return {
    pctUsed: Number(pctUsed.toFixed(2)),
    pctRemaining: Number((100 - pctUsed).toFixed(2)),
  };
}

async function main() {
  const { json } = parseArgs();
  const projectId = getProjectId();

  if (!projectId) {
    console.error(
      'Missing GOOGLE_CLOUD_PROJECT (or GCP_PROJECT). Set it to your GCP project ID that owns the Maps API keys.'
    );
    process.exit(1);
  }

  const services = parseServiceList();
  const serviceFilter = buildServiceFilter(services);
  const base = `resource.type="consumer_quota" (${serviceFilter})`;

  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/monitoring.read'],
  });
  const client = await auth.getClient();
  const { token: accessToken } = await client.getAccessToken();
  if (!accessToken) {
    console.error('Could not obtain access token. Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON key.');
    process.exit(1);
  }

  const kinds = [
    { name: 'rate', usageMetric: 'serviceruntime.googleapis.com/quota/rate/net_usage', limitMetric: 'serviceruntime.googleapis.com/quota/rate/limit' },
    { name: 'allocation', usageMetric: 'serviceruntime.googleapis.com/quota/allocation/usage', limitMetric: 'serviceruntime.googleapis.com/quota/allocation/limit' },
  ];

  const summary = {
    projectId,
    lookbackDays: Number(process.env.GOOGLE_QUOTA_LOOKBACK_DAYS || 7),
    servicesFiltered: services,
    sections: [],
    note:
      'Values come from Cloud Monitoring consumer-quota metrics. If a row shows no data, the API may not emit that quota yet, or the service name may differ for your project. Expand MAP_QUOTA_SERVICES or check IAM & Admin → Quotas in the console.',
  };

  for (const k of kinds) {
    const usageFilter = `metric.type="${k.usageMetric}" ${base}`;
    const limitFilter = `metric.type="${k.limitMetric}" ${base}`;

    let usageSeries = [];
    let limitSeries = [];
    try {
      [usageSeries, limitSeries] = await Promise.all([
        fetchAllTimeSeries(projectId, usageFilter, accessToken),
        fetchAllTimeSeries(projectId, limitFilter, accessToken),
      ]);
    } catch (e) {
      summary.sections.push({
        kind: k.name,
        error: e.message,
        hint:
          'Enable Cloud Monitoring API; use a service account with monitoring.viewer; ensure the project ID matches the project where Maps APIs run.',
      });
      continue;
    }

    let rows = mergeUsageAndLimit(usageSeries, limitSeries);
    rows = attachLimitsByMetric(rows, limitSeries);

    const enriched = rows.map((r) => {
      const { pctUsed, pctRemaining } = formatPct(r.usage, r.limit);
      return { ...r, pctUsed, pctRemaining };
    });

    summary.sections.push({
      kind: k.name,
      rowCount: enriched.length,
      rows: enriched,
    });
  }

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log('\n=== Google API quota snapshot (Cloud Monitoring) ===\n');
  console.log(`Project:     ${projectId}`);
  console.log(`Lookback:    ${summary.lookbackDays} days`);
  console.log(`Services:    ${services.length} configured (see MAP_QUOTA_SERVICES to change)\n`);

  for (const sec of summary.sections) {
    console.log(`--- ${sec.kind.toUpperCase()} quotas ---`);
    if (sec.error) {
      console.log(`  Error: ${sec.error}`);
      if (sec.hint) console.log(`  Hint:  ${sec.hint}`);
      console.log('');
      continue;
    }
    if (!sec.rows.length) {
      console.log('  No time series returned (no usage recorded for these services in this window, or labels differ).');
      console.log('');
      continue;
    }

    for (const r of sec.rows) {
      const u = r.usage != null ? r.usage : '—';
      const l = r.limit != null ? r.limit : '—';
      let pct = 'n/a';
      if (r.pctUsed != null) {
        pct = `${r.pctUsed}% used, ${r.pctRemaining}% headroom`;
      }
      console.log(`  [${r.service}]`);
      console.log(`    quota_metric: ${r.quota_metric}`);
      console.log(`    limit_name:   ${r.limit_name}`);
      console.log(`    location:     ${r.location}`);
      console.log(`    usage / limit: ${u} / ${l}`);
      console.log(`    approximate:   ${pct}`);
      console.log('');
    }
  }

  console.log('Note:', summary.note);
  console.log('');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
