const crypto = require('crypto');

const DEFAULT_STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

function parseTurnUrls(raw) {
  return String(raw || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
}

function staticTurnFromEnv() {
  const urls = parseTurnUrls(process.env.TURN_URLS || process.env.EXPO_PUBLIC_TURN_URLS);
  const username = (process.env.TURN_USERNAME || process.env.EXPO_PUBLIC_TURN_USERNAME || '').trim();
  const credential = (process.env.TURN_CREDENTIAL || process.env.EXPO_PUBLIC_TURN_CREDENTIAL || '').trim();
  if (!urls.length || !username || !credential) return null;
  return {
    urls: urls.length === 1 ? urls[0] : urls,
    username,
    credential,
  };
}

/**
 * Twilio Network Traversal — reuses existing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN.
 * https://www.twilio.com/docs/stun-turn
 */
async function iceServersFromTwilio() {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!sid || !token) return null;

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Tokens.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: '',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Twilio ICE token failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const iceServers = Array.isArray(data?.ice_servers) ? data.ice_servers : [];
  if (!iceServers.length) return null;
  return {
    iceServers,
    ttlSeconds: Number(data?.ttl) || 3600,
    provider: 'twilio',
  };
}

/**
 * Metered.ca TURN.
 *
 * Dashboard → Developers gives a **Secret Key** (account-scoped).
 * Correct flow:
 *   1) POST /api/v1/turn/credential?secretKey=...  → username/password/apiKey
 *   2) GET  /api/v1/turn/credentials?apiKey=<credential apiKey> → iceServers
 *
 * Env:
 *   METERED_DOMAIN=gbrides.metered.live
 *   METERED_SECRET_KEY=...   (or METERED_API_KEY as alias for the Developers secret)
 * Optional:
 *   METERED_CREDENTIAL_API_KEY=...  (skip create; use an existing credential apiKey)
 */
let meteredCache = null; // { iceServers, expiresAt, provider }

async function iceServersFromMetered() {
  const domain = (process.env.METERED_DOMAIN || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  const secretKey = (
    process.env.METERED_SECRET_KEY ||
    process.env.METERED_API_KEY ||
    ''
  ).trim();
  const credentialApiKey = (process.env.METERED_CREDENTIAL_API_KEY || '').trim();
  if (!domain) return null;
  if (!secretKey && !credentialApiKey) return null;

  const now = Date.now();
  if (meteredCache && meteredCache.expiresAt > now + 30_000) {
    return {
      iceServers: meteredCache.iceServers,
      ttlSeconds: Math.max(60, Math.floor((meteredCache.expiresAt - now) / 1000)),
      provider: meteredCache.provider,
    };
  }

  let fetchKey = credentialApiKey;
  let ttlSeconds = Math.max(
    600,
    Number(process.env.METERED_CREDENTIAL_TTL_SECONDS || 14400) || 14400
  );

  if (!fetchKey && secretKey) {
    const createUrl = `https://${domain}/api/v1/turn/credential?secretKey=${encodeURIComponent(secretKey)}`;
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expiryInSeconds: ttlSeconds,
        label: process.env.METERED_CREDENTIAL_LABEL || 'gbrides-calls',
      }),
    });
    if (!createRes.ok) {
      const text = await createRes.text().catch(() => '');
      throw new Error(`Metered create credential failed (${createRes.status}): ${text.slice(0, 200)}`);
    }
    const created = await createRes.json();
    fetchKey = (created?.apiKey || '').trim();
    if (Number.isFinite(Number(created?.expiryInSeconds)) && Number(created.expiryInSeconds) > 0) {
      ttlSeconds = Number(created.expiryInSeconds);
    }
    if (!fetchKey && created?.username && created?.password) {
      const iceServers = [
        { urls: 'stun:stun.relay.metered.ca:80' },
        {
          urls: 'turn:global.relay.metered.ca:80',
          username: created.username,
          credential: created.password,
        },
        {
          urls: 'turn:global.relay.metered.ca:80?transport=tcp',
          username: created.username,
          credential: created.password,
        },
        {
          urls: 'turn:global.relay.metered.ca:443',
          username: created.username,
          credential: created.password,
        },
        {
          urls: 'turns:global.relay.metered.ca:443?transport=tcp',
          username: created.username,
          credential: created.password,
        },
      ];
      meteredCache = {
        iceServers,
        expiresAt: Date.now() + Math.max(300, ttlSeconds - 120) * 1000,
        provider: 'metered',
      };
      return { iceServers, ttlSeconds, provider: 'metered' };
    }
    if (!fetchKey) {
      throw new Error('Metered create credential returned no apiKey');
    }
  }

  const url = `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(fetchKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Metered ICE credentials failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const iceServers = Array.isArray(data) ? data : Array.isArray(data?.iceServers) ? data.iceServers : [];
  if (!iceServers.length) return null;

  meteredCache = {
    iceServers,
    expiresAt: Date.now() + Math.max(300, ttlSeconds - 120) * 1000,
    provider: 'metered',
  };
  return {
    iceServers,
    ttlSeconds,
    provider: 'metered',
  };
}

/**
 * HMAC time-limited credentials for self-hosted coturn (static-auth-secret).
 * TURN_URLS + TURN_SHARED_SECRET required.
 */
function iceServersFromSharedSecret() {
  const urls = parseTurnUrls(process.env.TURN_URLS);
  const secret = (process.env.TURN_SHARED_SECRET || '').trim();
  if (!urls.length || !secret) return null;

  const ttlSeconds = Math.max(300, Number(process.env.TURN_CREDENTIAL_TTL_SECONDS || 3600) || 3600);
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiry}:gbrides`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');

  return {
    iceServers: [
      ...DEFAULT_STUN,
      {
        urls: urls.length === 1 ? urls[0] : urls,
        username,
        credential,
      },
    ],
    ttlSeconds,
    provider: 'coturn-shared-secret',
  };
}

/**
 * Build ICE servers for authenticated ride calls.
 * Preference: Twilio → Metered → shared-secret coturn → static TURN env → STUN-only.
 */
async function buildIceServers() {
  try {
    const twilio = await iceServersFromTwilio();
    if (twilio) {
      return {
        iceServers: mergeStun(twilio.iceServers),
        ttlSeconds: twilio.ttlSeconds,
        provider: twilio.provider,
        hasTurn: true,
      };
    }
  } catch (e) {
    console.warn('[webrtc] Twilio ICE failed:', e?.message || e);
  }

  try {
    const metered = await iceServersFromMetered();
    if (metered) {
      return {
        iceServers: mergeStun(metered.iceServers),
        ttlSeconds: metered.ttlSeconds,
        provider: metered.provider,
        hasTurn: true,
      };
    }
  } catch (e) {
    console.warn('[webrtc] Metered ICE failed:', e?.message || e);
  }

  const shared = iceServersFromSharedSecret();
  if (shared) {
    return { ...shared, hasTurn: true };
  }

  const staticTurn = staticTurnFromEnv();
  if (staticTurn) {
    return {
      iceServers: [...DEFAULT_STUN, staticTurn],
      ttlSeconds: 86400,
      provider: 'static-env',
      hasTurn: true,
    };
  }

  return {
    iceServers: [...DEFAULT_STUN],
    ttlSeconds: 3600,
    provider: 'stun-only',
    hasTurn: false,
  };
}

function mergeStun(servers) {
  const list = Array.isArray(servers) ? [...servers] : [];
  const existing = new Set(
    list.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls])).filter(Boolean).map(String)
  );
  for (const stun of DEFAULT_STUN) {
    if (!existing.has(String(stun.urls))) list.unshift(stun);
  }
  return list;
}

module.exports = {
  buildIceServers,
  DEFAULT_STUN,
};
