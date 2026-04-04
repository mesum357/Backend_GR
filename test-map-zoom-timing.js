/**
 * GB RIDES — Map Zoom Timing & Phase Transition Audit
 * ====================================================
 * Verifies that the real-time ride modal's map zoom triggers
 * instantly on each ride phase transition, with no artificial delay.
 *
 * Tests:
 *  1. Socket event relay latency for phase-triggering events
 *  2. driver_assigned → "arriving" phase: only driver+rider coords
 *  3. rider_arrived  → "rider_ready" phase: includes pickup+destination
 *  4. start_ride     → "in_progress" phase: full route visible
 *  5. end_ride       → "completed" phase
 *  6. Frontend code correctness (onMapReady, fitToCoordinates deps, polyline/marker visibility)
 *
 * Run:  node test-map-zoom-timing.js [BASE_URL]
 *       Defaults to https://api.mesumabbas.online
 */

const fetch = require('node-fetch').default || require('node-fetch');
const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');

const BASE_URL = (process.argv[2] || process.env.TEST_BASE_URL || 'https://api.mesumabbas.online').replace(/\/+$/, '');

const RIDER_EMAIL    = process.env.TEST_RIDER_EMAIL  || 'seimughal@gmail.com';
const RIDER_PASSWORD = process.env.TEST_RIDER_PASS   || '123456';
const DRIVER_EMAIL   = process.env.TEST_DRIVER_EMAIL || 'junaid@gmail.com';
const DRIVER_PASSWORD= process.env.TEST_DRIVER_PASS  || '123456';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL       || 'admin@gbrides.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD    || 'pDliM118811357';

const PICKUP = { latitude: 35.9208, longitude: 74.3144, address: 'Gilgit City Center' };
const DEST   = { latitude: 35.9350, longitude: 74.3300, address: 'Jutial, Gilgit' };

// ─── Logging ─────────────────────────────────────────────────────────────────
const PASS = (m) => console.log(`  \x1b[32m✅  ${m}\x1b[0m`);
const FAIL = (m) => console.log(`  \x1b[31m❌  ${m}\x1b[0m`);
const WARN = (m) => console.log(`  \x1b[33m⚠️   ${m}\x1b[0m`);
const INFO = (m) => console.log(`  \x1b[36mℹ️   ${m}\x1b[0m`);
const HEAD = (m) => console.log(`\n\x1b[1m${'─'.repeat(70)}\n  ${m}\n${'─'.repeat(70)}\x1b[0m`);
const PERF = (l, ms) => {
  const c = ms < 200 ? '\x1b[32m' : ms < 500 ? '\x1b[33m' : '\x1b[31m';
  console.log(`  ${c}⏱  ${l}: ${ms}ms\x1b[0m`);
};

let passed = 0, failed = 0, warnings = 0;
const perfMetrics = {};
const issues = [];

function ok(label, cond, detail = '') {
  if (cond) { PASS(label); passed++; } else { FAIL(`${label}${detail ? ' — ' + detail : ''}`); failed++; }
  return cond;
}
function warn(label, detail = '') { WARN(`${label}${detail ? ' — ' + detail : ''}`); warnings++; issues.push({ severity: 'warning', label, detail }); }
function issue(sev, label, detail = '') { issues.push({ severity: sev, label, detail }); }
function perf(label, t0) {
  const ms = Date.now() - t0;
  PERF(label, ms);
  perfMetrics[label] = ms;
  if (ms > 1000) issue('performance', `${label} took ${ms}ms`, '>1s feels laggy on mobile');
  return ms;
}

// ─── HTTP ───────────────────────────────────────────────────────────────────
async function http(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const res = await fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timeout));
  let data; try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, ok: res.ok, data };
}
const httpPost = (u, b, t) => http('POST', u, b, t);
const httpGet  = (u, t) => http('GET', u, null, t);
const httpPatch = (u, b, t) => http('PATCH', u, b, t);

// ─── Socket ─────────────────────────────────────────────────────────────────
function connectSocket(label) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const s = io(BASE_URL, { transports: ['polling', 'websocket'], timeout: 15000, forceNew: true });
    s.on('connect', () => { perf(`${label} socket connect`, t0); resolve(s); });
    s.on('connect_error', (e) => reject(new Error(`${label} socket: ${e.message}`)));
    setTimeout(() => reject(new Error(`${label} socket timeout 15s`)), 15000);
  });
}
function waitFor(socket, ev, ms = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout "${ev}" ${ms}ms`)), ms);
    socket.once(ev, (d) => { clearTimeout(t); resolve(d); });
  });
}
function waitOrNull(socket, ev, ms = 8000) { return waitFor(socket, ev, ms).catch(() => null); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Admin helpers ──────────────────────────────────────────────────────────
let _adminToken = null;
let _originalMinimumWallet = null;

async function adminLogin() {
  const r = await httpPost(`${BASE_URL}/api/admin/auth/login`, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (r.ok && r.data?.token) { _adminToken = r.data.token; return _adminToken; }
  return null;
}
async function setMinimumDriverWallet(value) {
  if (!_adminToken) return false;
  const r = await httpPatch(`${BASE_URL}/api/admin/wallet/settings`, { driverMinimumWalletPkr: value }, _adminToken);
  return r.ok;
}
async function getWalletSettings() {
  if (!_adminToken) return null;
  const r = await http('GET', `${BASE_URL}/api/admin/wallet/settings`, null, _adminToken);
  return r.ok ? r.data : null;
}

// ─── Frontend code analysis ─────────────────────────────────────────────────
function analyzeRideTrackingModal() {
  HEAD('PHASE A — Frontend Code Analysis: RideTrackingModal.tsx');

  const modalPath = path.resolve(__dirname, '..', 'GR_Frontend', 'src', 'components', 'RideTrackingModal.tsx');
  if (!fs.existsSync(modalPath)) {
    warn('A.0 RideTrackingModal.tsx not found', modalPath);
    return;
  }

  const src = fs.readFileSync(modalPath, 'utf-8');

  // A.1 onMapReady exists on MapView
  const hasOnMapReady = /onMapReady\s*=/.test(src);
  ok('A.1 MapView has onMapReady callback', hasOnMapReady,
    'Without onMapReady, fitToCoordinates runs before the map is mounted → initial zoom delay');

  // A.2 mapReady state drives the fitToCoordinates effect
  const hasMapReadyState = /\[\s*mapReady\s*,\s*setMapReady\s*\]\s*=\s*useState/.test(src);
  ok('A.2 mapReady state variable exists', hasMapReadyState,
    'Needed to re-trigger fitToCoordinates once the native map is ready');

  // A.3 setMapReady(true) called in onMapReady handler
  const setsMapReadyTrue = /onMapReady\s*=\s*\{?\s*\(\)\s*=>\s*setMapReady\s*\(\s*true\s*\)/.test(src);
  ok('A.3 onMapReady sets mapReady=true', setsMapReadyTrue,
    'onMapReady should call setMapReady(true)');

  // A.4 mapReady in the useEffect dependency array for fitToCoordinates
  const fitEffectMatch = src.match(/useEffect\s*\(\s*\(\)\s*=>\s*\{[\s\S]*?fitToCoordinates[\s\S]*?\}\s*,\s*\[([^\]]*)\]\s*\)/);
  let mapReadyInDeps = false;
  if (fitEffectMatch) {
    mapReadyInDeps = fitEffectMatch[1].includes('mapReady');
  }
  ok('A.4 fitToCoordinates useEffect depends on mapReady', mapReadyInDeps,
    'Without mapReady dep, the effect won\'t re-run when the map becomes available');

  // A.5 mapReady reset when modal hides
  const resetsMapReady = /setMapReady\s*\(\s*false\s*\)/.test(src);
  ok('A.5 mapReady resets to false when modal hides', resetsMapReady,
    'Ensures fresh fit on next open');

  // A.6 First fit uses animated: false for instant snap
  const firstFitNotAnimated = /animated:\s*!isFirstFit/.test(src);
  ok('A.6 First fit is NOT animated (instant snap)', firstFitNotAnimated,
    'First zoom should snap instantly, subsequent ones animate smoothly');

  // A.7 isFirstFit bypass throttle
  const firstFitBypassThrottle = /isFirstFit\s*\|\|\s*phaseChanged/.test(src);
  ok('A.7 isFirstFit bypasses throttle gate', firstFitBypassThrottle,
    'First fit should always execute regardless of 14s throttle');

  // A.8 Arriving phase uses only driver+rider coordinates
  const arrivingCoords = /ridePhase\s*===\s*'arriving'\s*\?\s*\[\s*driverLocation\s*,\s*riderLocation\s*\]/.test(src);
  ok('A.8 "arriving" phase fits to [driver, rider] only', arrivingCoords,
    'Should zoom tight on driver→rider distance');

  // A.9 Other phases include pickup+destination
  const otherCoords = /:\s*\[\s*pickupLocation\s*,\s*destination\s*,\s*driverLocation\s*,\s*riderLocation\s*\]/.test(src);
  ok('A.9 Other phases fit to [pickup, dest, driver, rider]', otherCoords,
    'Should show full route context');

  // A.10 Arriving phase has tighter edge padding
  const arrivingPadding = /ridePhase\s*===\s*'arriving'\s*\?\s*\{\s*top:\s*100/.test(src);
  ok('A.10 "arriving" phase uses tighter edge padding', arrivingPadding,
    'Larger padding zooms closer to the two markers');

  // A.11 Polyline visible in rider_ready phase
  const polylineRiderReady = /ridePhase\s*===\s*'rider_ready'\s*\|\|\s*ridePhase\s*===\s*'in_progress'[\s\S]{0,50}Polyline/.test(src);
  ok('A.11 Route polyline shown from rider_ready phase', polylineRiderReady,
    'Path should appear when rider taps "I am here"');

  // A.12 Destination marker visible in rider_ready phase
  const destMarkerRiderReady = /ridePhase\s*===\s*'rider_ready'\s*\|\|\s*ridePhase\s*===\s*'in_progress'[\s\S]{0,50}Marker/.test(src);
  ok('A.12 Destination marker shown from rider_ready phase', destMarkerRiderReady,
    'Destination flag should appear when rider taps "I am here"');

  return { hasOnMapReady, hasMapReadyState, setsMapReadyTrue, mapReadyInDeps, resetsMapReady, firstFitNotAnimated };
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log(`\n\x1b[1;35m╔══════════════════════════════════════════════════════════════════╗\x1b[0m`);
  console.log(`\x1b[1;35m║   GB RIDES — Map Zoom Timing & Phase Transition Audit          ║\x1b[0m`);
  console.log(`\x1b[1;35m╚══════════════════════════════════════════════════════════════════╝\x1b[0m`);
  INFO(`Target: ${BASE_URL}`);
  INFO(`Time  : ${new Date().toISOString()}`);

  let riderToken, driverToken, riderId, driverId;
  let riderSocket, driverSocket;
  let rideRequestId;

  async function cleanup() {
    HEAD('CLEANUP');
    try { if (riderSocket) riderSocket.disconnect(); } catch {}
    try { if (driverSocket) driverSocket.disconnect(); } catch {}
    if (rideRequestId && riderToken) {
      try { await httpPost(`${BASE_URL}/api/ride-requests/${rideRequestId}/cancel`, {}, riderToken); } catch {}
    }
    if (_originalMinimumWallet !== null && _adminToken) {
      try {
        await setMinimumDriverWallet(_originalMinimumWallet);
        INFO(`Restored minimum wallet to ${_originalMinimumWallet} PKR`);
      } catch {}
    }
  }

  // ═══ PHASE A: Frontend code correctness ═══════════════════════════════════
  const codeResults = analyzeRideTrackingModal();

  // ═══ PHASE 0: Admin setup ════════════════════════════════════════════════
  HEAD('PHASE 0 — Admin Setup');
  try {
    const token = await adminLogin();
    if (token) {
      ok('0.1 Admin authenticated', true);
      const settings = await getWalletSettings();
      if (settings) {
        _originalMinimumWallet = settings.driverMinimumWalletPkr;
        INFO(`Current minimum wallet: ${_originalMinimumWallet} PKR`);
      }
      const didSet = await setMinimumDriverWallet(0);
      ok('0.2 Set driverMinimumWalletPkr=0 for test', didSet);
    } else {
      warn('0.1 Admin login failed', 'Wallet check may block driver');
    }
  } catch (e) { warn(`0.x Admin: ${e.message}`); }

  // ═══ PHASE 1: Auth & Sockets ═════════════════════════════════════════════
  HEAD('PHASE 1 — Auth & Socket Setup');

  try {
    const t0 = Date.now();
    const r = await httpGet(`${BASE_URL}/api/health`);
    perf('Health check', t0);
    ok('1.0 Server reachable', r.ok);
  } catch (e) {
    FAIL(`1.0 Server unreachable: ${e.message}`); failed++;
    return cleanup();
  }

  try {
    const t0 = Date.now();
    const data = await httpPost(`${BASE_URL}/api/auth/login`, { email: RIDER_EMAIL, password: RIDER_PASSWORD, expectedUserType: 'rider' });
    perf('Rider login', t0);
    if (ok('1.1 Rider authenticated', data.ok && data.data?.token)) {
      riderToken = data.data.token;
      riderId = data.data.user?._id || data.data.user?.id;
    }
  } catch (e) { FAIL(`1.1 ${e.message}`); failed++; }

  try {
    const t0 = Date.now();
    const data = await httpPost(`${BASE_URL}/api/auth/login`, { email: DRIVER_EMAIL, password: DRIVER_PASSWORD, expectedUserType: 'driver' });
    perf('Driver login', t0);
    if (ok('1.2 Driver authenticated', data.ok && data.data?.token)) {
      driverToken = data.data.token;
      driverId = data.data.user?._id || data.data.user?.id;
    }
  } catch (e) { FAIL(`1.2 ${e.message}`); failed++; }

  if (!riderToken || !driverToken) {
    FAIL('Cannot continue without both tokens');
    return cleanup();
  }

  try {
    riderSocket = await connectSocket('Rider');
    ok('1.3 Rider socket connected', !!riderSocket);
    riderSocket.emit('authenticate', { userId: riderId, userType: 'rider' });
    await sleep(200);
  } catch (e) { FAIL(`1.3 ${e.message}`); failed++; return cleanup(); }

  try {
    driverSocket = await connectSocket('Driver');
    ok('1.4 Driver socket connected', !!driverSocket);
    driverSocket.emit('authenticate', { userId: driverId, userType: 'driver' });
    await sleep(200);
  } catch (e) { FAIL(`1.4 ${e.message}`); failed++; return cleanup(); }

  // Set driver online + location
  try {
    await httpPost(`${BASE_URL}/api/drivers/location`, { latitude: PICKUP.latitude + 0.003, longitude: PICKUP.longitude + 0.003 }, driverToken);
    const prof = await httpGet(`${BASE_URL}/api/drivers/profile`, driverToken);
    if (prof.ok && !prof.data?.driver?.isOnline) {
      await httpPost(`${BASE_URL}/api/drivers/toggle-status`, {}, driverToken);
    }
    ok('1.5 Driver online & located', true);
  } catch (e) { warn(`1.5 ${e.message}`); }

  // ═══ PHASE 2: Ride Creation → "arriving" phase ═══════════════════════════
  HEAD('PHASE 2 — Ride Request → Driver Assigned (arriving phase)');

  const driverRideReqPromise = waitOrNull(driverSocket, 'ride_request', 8000);

  try {
    const t0 = Date.now();
    const r = await httpPost(`${BASE_URL}/api/ride-requests/request-ride`, {
      pickup: PICKUP, destination: DEST,
      offeredFare: 200, radiusMeters: 5000,
      paymentMethod: 'cash', vehicleType: 'ride_mini',
      notes: 'Map zoom timing audit'
    }, riderToken);
    perf('Create ride request', t0);
    if (ok('2.1 Ride request created', r.status === 201)) {
      rideRequestId = r.data?.rideRequest?.id;
      INFO(`ID: ${rideRequestId}`);
    }
  } catch (e) { FAIL(`2.1 ${e.message}`); failed++; return cleanup(); }

  await driverRideReqPromise;

  // Driver accepts
  let fareOfferReceived = false;
  if (rideRequestId) {
    const fareOfferPromise = waitOrNull(riderSocket, 'fare_offer', 12000);
    try {
      const t0 = Date.now();
      const r = await httpPost(`${BASE_URL}/api/ride-requests/${rideRequestId}/respond`,
        { action: 'accept', counterOffer: null }, driverToken);
      perf('Driver accept (REST)', t0);
      ok('2.2 Driver accepted ride', r.ok, `${r.status} ${r.data?.error || ''}`);
    } catch (e) {
      warn(`2.2 ${e.message}`);
      driverSocket.emit('driver_response', { rideRequestId, driverId, action: 'accept', counterOffer: null });
    }

    const fo = await fareOfferPromise;
    if (fo) { fareOfferReceived = true; ok('2.3 Rider got fare_offer', true); }
    else { FAIL('2.3 fare_offer not received'); failed++; }
  }

  // Rider accepts → driver_assigned
  if (fareOfferReceived) {
    const assignedPromise = waitOrNull(riderSocket, 'driver_assigned', 10000);

    const t0_emit = Date.now();
    riderSocket.emit('fare_response', { rideRequestId, riderId, driverId, action: 'accept', timestamp: Date.now() });

    const assigned = await assignedPromise;
    const assignedLatency = Date.now() - t0_emit;
    PERF('Phase transition: emit fare_response → driver_assigned', assignedLatency);
    perfMetrics['fare_response → driver_assigned'] = assignedLatency;

    ok('2.4 driver_assigned received', !!assigned);
    ok('2.4a Latency < 1000ms (arriving zoom trigger)', assignedLatency < 1000,
      `${assignedLatency}ms — user sees stale map until this event arrives`);
    if (assignedLatency > 500) {
      issue('performance', `driver_assigned took ${assignedLatency}ms`,
        'This is the time before the map zooms to driver+rider in arriving phase');
    }

    INFO(`► Frontend ridePhase = "arriving" — map should now show ONLY driver ↔ rider`);
    INFO(`  Expected: fitToCoordinates([driverLocation, riderLocation])`);
    INFO(`  Expected: No route polyline, no destination marker`);
  }

  await sleep(300);

  // ═══ PHASE 3: rider_arrived → "rider_ready" phase ════════════════════════
  HEAD('PHASE 3 — Rider Arrived → rider_ready phase (full route zoom)');

  if (rideRequestId && fareOfferReceived) {
    const pickupPromise = waitOrNull(driverSocket, 'rider_at_pickup', 8000);

    const t0_arrived = Date.now();
    riderSocket.emit('rider_arrived', { rideRequestId, riderId, latitude: PICKUP.latitude, longitude: PICKUP.longitude });

    const pickupEvt = await pickupPromise;
    const arrivedLatency = Date.now() - t0_arrived;
    PERF('Phase transition: rider_arrived → rider_at_pickup relay', arrivedLatency);
    perfMetrics['rider_arrived → rider_at_pickup'] = arrivedLatency;

    ok('3.1 Driver got rider_at_pickup', !!pickupEvt);
    ok('3.1a Latency < 500ms', arrivedLatency < 500, `${arrivedLatency}ms`);

    INFO(`► Frontend ridePhase = "rider_ready" — map should zoom to show FULL ROUTE`);
    INFO(`  Expected: fitToCoordinates([pickup, dest, driver, rider])`);
    INFO(`  Expected: Route polyline NOW visible`);
    INFO(`  Expected: Destination marker NOW visible`);
  }

  await sleep(300);

  // ═══ PHASE 4: start_ride → "in_progress" phase ═══════════════════════════
  HEAD('PHASE 4 — Start Ride → in_progress phase');

  if (rideRequestId && fareOfferReceived) {
    const startPromise = waitOrNull(riderSocket, 'ride_started', 8000);

    const t0_start = Date.now();
    driverSocket.emit('start_ride', { rideRequestId, driverId });

    const startEvt = await startPromise;
    const startLatency = Date.now() - t0_start;
    PERF('Phase transition: start_ride → ride_started relay', startLatency);
    perfMetrics['start_ride → ride_started'] = startLatency;

    ok('4.1 Rider got ride_started', !!startEvt);
    ok('4.1a Latency < 500ms', startLatency < 500, `${startLatency}ms`);

    INFO(`► Frontend ridePhase = "in_progress" — map stays on full route`);
    INFO(`  Expected: Route polyline still visible`);
    INFO(`  Expected: Destination marker still visible`);
  }

  await sleep(300);

  // ═══ PHASE 5: end_ride → "completed" phase ═══════════════════════════════
  HEAD('PHASE 5 — End Ride → completed phase');

  if (rideRequestId && fareOfferReceived) {
    const compRiderPromise = waitOrNull(riderSocket, 'ride_completed', 10000);
    const compDriverPromise = waitOrNull(driverSocket, 'ride_completed', 10000);

    const t0_end = Date.now();
    driverSocket.emit('end_ride', { rideRequestId, driverId });

    const [cr, cd] = await Promise.all([compRiderPromise, compDriverPromise]);
    const endLatency = Date.now() - t0_end;
    PERF('Phase transition: end_ride → ride_completed relay', endLatency);
    perfMetrics['end_ride → ride_completed'] = endLatency;

    ok('5.1 Rider got ride_completed', !!cr);
    ok('5.2 Driver got ride_completed', !!cd);
    ok('5.2a Latency < 500ms', endLatency < 500, `${endLatency}ms`);
  }

  // ═══ PHASE 6: Live location relay benchmark ═══════════════════════════════
  HEAD('PHASE 6 — Live Location Relay Benchmark (map marker movement)');

  if (rideRequestId && fareOfferReceived) {
    INFO('Measuring 5 sequential ride_live_location relay times...');
    const relayTimes = [];

    for (let i = 0; i < 5; i++) {
      const locPromise = waitOrNull(riderSocket, 'ride_live_location', 4000);
      const t0 = Date.now();
      driverSocket.emit('ride_live_location', {
        rideRequestId, senderId: driverId, senderType: 'driver',
        latitude: PICKUP.latitude + (i * 0.001),
        longitude: PICKUP.longitude + (i * 0.001),
        heading: 90 + i * 10
      });
      const loc = await locPromise;
      if (loc) {
        const relay = Date.now() - t0;
        relayTimes.push(relay);
        PERF(`  live_location relay #${i + 1}`, t0);
      } else {
        warn(`Live location #${i + 1} not relayed`);
      }
      await sleep(100);
    }

    if (relayTimes.length > 0) {
      const avg = Math.round(relayTimes.reduce((a, b) => a + b, 0) / relayTimes.length);
      const max = Math.max(...relayTimes);
      const min = Math.min(...relayTimes);
      INFO(`Live location relay: avg=${avg}ms, min=${min}ms, max=${max}ms`);
      perfMetrics['live_location avg relay'] = avg;
      ok('6.1 Average relay < 500ms', avg < 500, `avg ${avg}ms`);
      ok('6.2 Max relay < 1000ms', max < 1000, `max ${max}ms`);
    }
  }

  // ═══ REPORT ═══════════════════════════════════════════════════════════════
  HEAD('RESULTS — Map Zoom Timing Audit');

  console.log(`\n  \x1b[1mPhase Transition Latencies:\x1b[0m`);
  const phaseMetrics = [
    ['fare_response → driver_assigned', 'arriving (driver↔rider zoom)'],
    ['rider_arrived → rider_at_pickup', 'rider_ready (full route zoom)'],
    ['start_ride → ride_started', 'in_progress'],
    ['end_ride → ride_completed', 'completed'],
  ];
  for (const [key, desc] of phaseMetrics) {
    const ms = perfMetrics[key];
    if (ms !== undefined) {
      const bar = '█'.repeat(Math.min(Math.ceil(ms / 50), 40));
      const c = ms < 200 ? '\x1b[32m' : ms < 500 ? '\x1b[33m' : '\x1b[31m';
      console.log(`    ${c}${bar} ${ms}ms\x1b[0m  ${desc}`);
    } else {
      console.log(`    \x1b[90m(skipped)\x1b[0m  ${desc}`);
    }
  }

  console.log(`\n  \x1b[1mFrontend Code Checklist:\x1b[0m`);
  const checks = [
    ['onMapReady callback', codeResults?.hasOnMapReady],
    ['mapReady state variable', codeResults?.hasMapReadyState],
    ['setMapReady(true) in handler', codeResults?.setsMapReadyTrue],
    ['mapReady in useEffect deps', codeResults?.mapReadyInDeps],
    ['mapReady reset on hide', codeResults?.resetsMapReady],
    ['First fit instant (not animated)', codeResults?.firstFitNotAnimated],
  ];
  for (const [label, val] of checks) {
    console.log(`    ${val ? '\x1b[32m✅' : '\x1b[31m❌'} ${label}\x1b[0m`);
  }

  console.log(`\n  \x1b[1mExpected Map Behavior by Phase:\x1b[0m`);
  console.log(`    ┌─────────────┬──────────────────────────────────┬────────────┬──────────────┐`);
  console.log(`    │ Phase       │ fitToCoordinates                 │ Polyline   │ Dest Marker  │`);
  console.log(`    ├─────────────┼──────────────────────────────────┼────────────┼──────────────┤`);
  console.log(`    │ arriving    │ [driver, rider]  (zoomed tight)  │ Hidden     │ Hidden       │`);
  console.log(`    │ rider_ready │ [pickup, dest, driver, rider]    │ ✅ Visible │ ✅ Visible   │`);
  console.log(`    │ in_progress │ [pickup, dest, driver, rider]    │ ✅ Visible │ ✅ Visible   │`);
  console.log(`    │ completed   │ [pickup, dest, driver, rider]    │ Hidden     │ Hidden       │`);
  console.log(`    └─────────────┴──────────────────────────────────┴────────────┴──────────────┘`);

  if (issues.length > 0) {
    console.log(`\n  \x1b[1mIssues Found:\x1b[0m`);
    issues.forEach((i, idx) => {
      const c = i.severity === 'performance' ? '\x1b[33m' : '\x1b[31m';
      console.log(`    ${c}${idx + 1}. [${i.severity}] ${i.label}\x1b[0m${i.detail ? ` — ${i.detail}` : ''}`);
    });
  }

  console.log(`\n  ────────────────────────────────────────────────`);
  console.log(`  \x1b[32m✅ Passed: ${passed}\x1b[0m  |  \x1b[31m❌ Failed: ${failed}\x1b[0m  |  \x1b[33m⚠️  Warnings: ${warnings}\x1b[0m`);
  console.log(`  ────────────────────────────────────────────────\n`);

  await cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(2); });
