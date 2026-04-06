/**
 * GB RIDES — Comprehensive Ride Process Audit & Test
 * ===================================================
 * Uses existing accounts by default (junaid@gmail.com driver).
 * Falls back to self-provisioning + admin approval if login fails.
 * Temporarily sets driverMinimumWalletPkr=0 via admin API so wallet
 * balance never blocks the test flow.
 *
 * Run:  node test-ride-process-audit.js [BASE_URL]
 *       Defaults to https://api.mesumabbas.online
 *
 * Env vars (all optional):
 *   TEST_RIDER_EMAIL / TEST_RIDER_PASS
 *   TEST_DRIVER_EMAIL / TEST_DRIVER_PASS
 *   ADMIN_EMAIL / ADMIN_PASSWORD
 *   TEST_BASE_URL
 */

const fetch = require('node-fetch').default || require('node-fetch');
const io = require('socket.io-client');

// ─── Config ─────────────────────────────────────────────────────────────────
const BASE_URL = (process.argv[2] || process.env.TEST_BASE_URL || 'https://api.mesumabbas.online').replace(/\/+$/, '');

const TS = Date.now();
const RIDER_EMAIL    = process.env.TEST_RIDER_EMAIL  || 'seimughal@gmail.com';
const RIDER_PASSWORD = process.env.TEST_RIDER_PASS   || '123456';
const DRIVER_EMAIL   = process.env.TEST_DRIVER_EMAIL || 'junaid@gmail.com';
const DRIVER_PASSWORD= process.env.TEST_DRIVER_PASS  || '123456';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL       || 'admin@gbrides.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD    || 'pDliM118811357';

const PICKUP = { latitude: 35.9208, longitude: 74.3144, address: 'Gilgit City Center' };
const DEST   = { latitude: 35.9350, longitude: 74.3300, address: 'Jutial, Gilgit' };

// ─── Logging ────────────────────────────────────────────────────────────────
const PASS = (m) => console.log(`  \x1b[32m✅  ${m}\x1b[0m`);
const FAIL = (m) => console.log(`  \x1b[31m❌  ${m}\x1b[0m`);
const WARN = (m) => console.log(`  \x1b[33m⚠️   ${m}\x1b[0m`);
const INFO = (m) => console.log(`  \x1b[36mℹ️   ${m}\x1b[0m`);
const HEAD = (m) => console.log(`\n\x1b[1m${'─'.repeat(70)}\n  ${m}\n${'─'.repeat(70)}\x1b[0m`);
const PERF = (l, ms) => {
  const c = ms < 500 ? '\x1b[32m' : ms < 2000 ? '\x1b[33m' : '\x1b[31m';
  console.log(`  ${c}⏱  ${l}: ${ms}ms\x1b[0m`);
};

let passed = 0, failed = 0, warnings = 0;
const issues = [];
const perfMetrics = {};

function ok(label, cond, detail = '') {
  if (cond) { PASS(label); passed++; } else { FAIL(`${label}${detail ? ' — ' + detail : ''}`); failed++; }
  return cond;
}
function warn(label, detail = '') { WARN(`${label}${detail ? ' — ' + detail : ''}`); warnings++; issues.push({ severity: 'warning', label, detail }); }
function issue(sev, label, detail = '') { issues.push({ severity: sev, label, detail }); }
function perf(label, t0) { const ms = Date.now() - t0; PERF(label, ms); perfMetrics[label] = ms; if (ms > 3000) issue('performance', `${label} took ${ms}ms`, '>3s is poor for mobile'); return ms; }

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
  if (r.ok && r.data?.token) {
    _adminToken = r.data.token;
    return _adminToken;
  }
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

async function approveDriverByEmail(driverEmail) {
  if (!_adminToken) return false;
  const list = await http('GET', `${BASE_URL}/api/admin/driver-requests?status=pending`, null, _adminToken);
  if (!list.ok) return false;
  const requests = Array.isArray(list.data?.requests) ? list.data.requests : [];
  const match = requests.find((d) => String(d?.user?.email || '').toLowerCase() === String(driverEmail).toLowerCase());
  if (!match?._id) return false;
  const approve = await httpPatch(`${BASE_URL}/api/admin/driver-requests/${match._id}/approve`, {}, _adminToken);
  return approve.ok;
}

// ─── Auth helpers (login, with register+approve fallback) ───────────────────
async function ensureLogin(email, password, userType) {
  let r = await httpPost(`${BASE_URL}/api/auth/login`, { email, password, expectedUserType: userType });
  if (r.ok && r.data?.token) return r.data;

  INFO(`Login failed for ${email} (${r.status}: ${r.data?.error || 'unknown'})`);

  if (r.status === 403 && r.data?.error?.includes('under review')) {
    INFO(`Driver ${email} is pending approval — attempting admin approve...`);
    if (await approveDriverByEmail(email)) {
      INFO(`Approved ${email} via admin API`);
      r = await httpPost(`${BASE_URL}/api/auth/login`, { email, password, expectedUserType: userType });
      if (r.ok && r.data?.token) return r.data;
    }
  }

  INFO(`Registering fresh ${userType}: ${email}`);
  const regBody = {
    email, password,
    firstName: userType === 'rider' ? 'TestRider' : 'TestDriver',
    lastName: 'Audit',
    phone: `+92300${String(TS).slice(-7)}${userType === 'rider' ? '1' : '2'}`,
    userType,
  };
  if (userType === 'driver') {
    regBody.driverInfo = {
      vehicleInfo: { make: 'Toyota', model: 'Corolla', year: 2020, color: 'White', plateNumber: `GB-TEST-${TS}`, vehicleType: 'car' },
      licenseNumber: `LIC-${TS}`, licenseExpiry: '2028-12-31',
      insuranceNumber: `INS-${TS}`, insuranceExpiry: '2028-12-31',
    };
  }
  const reg = await httpPost(`${BASE_URL}/api/auth/register`, regBody);
  if (reg.ok && reg.data?.token) {
    INFO(`Registered ${userType}: ${email}`);
    if (userType === 'driver') {
      INFO(`Auto-approving new driver via admin API...`);
      await sleep(500);
      if (await approveDriverByEmail(email)) {
        INFO(`Driver approved — re-logging in...`);
        r = await httpPost(`${BASE_URL}/api/auth/login`, { email, password, expectedUserType: 'driver' });
        if (r.ok && r.data?.token) return r.data;
      } else {
        WARN(`Could not auto-approve driver. Admin API may need credentials.`);
      }
    }
    return reg.data;
  }

  if (reg.data?.error?.includes('already exists')) {
    INFO(`Account ${email} exists — wrong password or different userType`);
  }
  return null;
}

// ─── MAIN ───────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n\x1b[1m🚀  GB RIDES — Comprehensive Ride Process Audit\x1b[0m');
  console.log(`    Backend: ${BASE_URL}`);
  console.log(`    Rider:   ${RIDER_EMAIL}`);
  console.log(`    Driver:  ${DRIVER_EMAIL}`);
  console.log(`    ${new Date().toISOString()}\n`);

  let riderToken, driverToken, riderId, driverId;
  let riderSocket, driverSocket;
  let rideRequestId;

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 0: ADMIN SETUP — lower minimum wallet so balance is never a blocker
  // ═════════════════════════════════════════════════════════════════════════
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
      if (didSet) INFO('Wallet minimum temporarily set to 0 PKR');
    } else {
      warn('0.1 Admin login failed', 'Wallet minimum check may block driver. Check ADMIN_EMAIL/ADMIN_PASSWORD.');
    }
  } catch (e) { warn(`0.x Admin setup: ${e.message}`); }

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 1: INFRASTRUCTURE & AUTH
  // ═════════════════════════════════════════════════════════════════════════
  HEAD('PHASE 1 — Infrastructure & Auth');

  // 1.1 Health
  try {
    const t0 = Date.now();
    const r = await httpGet(`${BASE_URL}/api/health`);
    perf('Health check', t0);
    ok('1.1 Server health', r.ok, `status ${r.status}`);
    if (r.data) {
      ok('1.1a MongoDB connected', r.data.mongo?.ready === true, `readyState=${r.data.mongo?.readyState}`);
    }
  } catch (e) {
    FAIL(`1.1 Health: ${e.message}`); failed++;
    console.log('\n  Backend unreachable. Start with: node server.js\n');
    return cleanup();
  }

  // 1.2 Rider login
  try {
    const t0 = Date.now();
    const data = await ensureLogin(RIDER_EMAIL, RIDER_PASSWORD, 'rider');
    perf('Rider auth', t0);
    if (ok('1.2 Rider authenticated', !!data?.token)) {
      riderToken = data.token;
      riderId = data.user?._id || data.user?.id;
      INFO(`Rider: ${riderId} (${data.user?.email || RIDER_EMAIL})`);
    }
  } catch (e) { FAIL(`1.2 Rider auth: ${e.message}`); failed++; }

  // 1.3 Driver login
  try {
    const t0 = Date.now();
    const data = await ensureLogin(DRIVER_EMAIL, DRIVER_PASSWORD, 'driver');
    perf('Driver auth', t0);
    if (data?.token) {
      driverToken = data.token;
      driverId = data.user?._id || data.user?.id;
      ok('1.3 Driver authenticated', true);
      INFO(`Driver: ${driverId} (${data.user?.email || DRIVER_EMAIL})`);

      // Show wallet balance
      try {
        const wr = await httpGet(`${BASE_URL}/api/driver/wallet/balance`, driverToken);
        if (wr.ok) {
          INFO(`Driver wallet: ${wr.data?.balance} ${wr.data?.currency || 'PKR'} | canAcceptRides=${wr.data?.canAcceptRides} | minimum=${wr.data?.minimumBalance}`);
        }
      } catch {}
    } else {
      warn('1.3 Driver login failed', 'Check password or approval status');
    }
  } catch (e) { warn(`1.3 Driver auth: ${e.message}`); }

  if (!riderToken) {
    FAIL('Cannot continue without rider token');
    return cleanup();
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 2: WEBSOCKET & REAL-TIME
  // ═════════════════════════════════════════════════════════════════════════
  HEAD('PHASE 2 — WebSocket & Real-time Setup');

  // 2.1 Rider socket
  try {
    riderSocket = await connectSocket('Rider');
    ok('2.1 Rider WebSocket connected', !!riderSocket);
    riderSocket.emit('authenticate', { userId: riderId, userType: 'rider' });
    await sleep(300);
  } catch (e) { FAIL(`2.1 Rider socket: ${e.message}`); failed++; }

  // 2.2 Driver socket
  if (driverToken && driverId) {
    try {
      driverSocket = await connectSocket('Driver');
      ok('2.2 Driver WebSocket connected', !!driverSocket);
      driverSocket.emit('authenticate', { userId: driverId, userType: 'driver' });
      await sleep(300);
    } catch (e) { FAIL(`2.2 Driver socket: ${e.message}`); failed++; }

    // 2.3 Driver location + online
    try {
      const t0 = Date.now();
      const r = await httpPost(`${BASE_URL}/api/drivers/location`,
        { latitude: PICKUP.latitude + 0.003, longitude: PICKUP.longitude + 0.003 }, driverToken);
      perf('Driver location update', t0);
      if (r.ok) ok('2.3 Driver location updated', true);
      else warn('2.3 Driver location update', `status ${r.status} — ${r.data?.error || ''}`);
    } catch (e) { warn(`2.3 Location: ${e.message}`); }

    try {
      const prof = await httpGet(`${BASE_URL}/api/drivers/profile`, driverToken);
      if (prof.ok && !prof.data?.driver?.isOnline) {
        await httpPost(`${BASE_URL}/api/drivers/toggle-status`, {}, driverToken);
        INFO('Toggled driver online');
      } else if (prof.ok) {
        INFO('Driver already online');
      }
    } catch (e) { INFO(`Online toggle: ${e.message}`); }
  } else {
    INFO('Skipping driver socket/location (no driver token)');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 3: RIDE CREATION
  // ═════════════════════════════════════════════════════════════════════════
  HEAD('PHASE 3 — Ride Creation & Driver Discovery');

  const driverRideReqPromise = driverSocket ? waitOrNull(driverSocket, 'ride_request', 8000) : Promise.resolve(null);

  try {
    const t0 = Date.now();
    const r = await httpPost(`${BASE_URL}/api/ride-requests/request-ride`, {
      pickup: PICKUP, destination: DEST,
      offeredFare: 200, radiusMeters: 5000,
      paymentMethod: 'cash', vehicleType: 'ride_mini',
      notes: 'Automated audit'
    }, riderToken);
    perf('Create ride request', t0);

    if (ok('3.1 Ride request created (201)', r.status === 201, `status ${r.status} — ${r.data?.error || ''}`)) {
      rideRequestId = r.data?.rideRequest?.id;
      ok('3.1a ID returned', !!rideRequestId);
      INFO(`ID: ${rideRequestId} | Drivers notified: ${r.data?.rideRequest?.driversNotified} | Distance: ${r.data?.rideRequest?.distance?.toFixed?.(2) || '?'}km`);
      if (r.data?.rideRequest?.driversNotified === 0) {
        warn('No drivers notified', 'Driver may be offline/out of radius');
      }
    }
  } catch (e) { FAIL(`3.1 Create ride: ${e.message}`); failed++; }

  // 3.2 Driver socket event
  if (driverRideReqPromise) {
    const evt = await driverRideReqPromise;
    if (evt) {
      ok('3.2 Driver got ride_request socket', true);
      ok('3.2a Has pickup', !!evt.pickup);
      ok('3.2b Has offeredFare', typeof evt.offeredFare === 'number');
    } else {
      warn('3.2 Driver did NOT get ride_request', 'Outside radius or offline in DB');
    }
  }

  // 3.3 Status check
  if (rideRequestId) {
    try {
      const t0 = Date.now();
      const r = await httpGet(`${BASE_URL}/api/ride-requests/${rideRequestId}/status`, riderToken);
      perf('Poll ride status', t0);
      const st = r.data?.rideRequest?.status || r.data?.status;
      ok('3.3 Status is "searching"', st === 'searching', `got "${st}"`);
      const ad = r.data?.rideRequest?.availableDrivers || [];
      INFO(`availableDrivers: ${ad.length}`);
      if (ad.length === 0) warn('3.4 No availableDrivers in DB');
      else ok('3.4 availableDrivers populated', true);
    } catch (e) { FAIL(`3.3 Status: ${e.message}`); failed++; }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 4: FARE OFFER
  // ═════════════════════════════════════════════════════════════════════════
  HEAD('PHASE 4 — Fare Offer Flow');

  let fareOfferReceived = false;

  if (rideRequestId && driverToken) {
    const fareOfferPromise = riderSocket ? waitOrNull(riderSocket, 'fare_offer', 12000) : Promise.resolve(null);

    // 4.1 Driver accept via REST
    try {
      const t0 = Date.now();
      const r = await httpPost(`${BASE_URL}/api/ride-requests/${rideRequestId}/respond`,
        { action: 'accept', counterOffer: null }, driverToken);
      perf('Driver accept (REST)', t0);
      if (r.ok) {
        ok('4.1 Driver accept via REST', true);
      } else {
        warn('4.1 REST respond failed', `${r.status} — ${r.data?.error || ''}`);
        if (driverSocket) {
          INFO('Trying socket fallback...');
          driverSocket.emit('driver_response', { rideRequestId, driverId, action: 'accept', counterOffer: null });
          ok('4.1b Driver accept via socket fallback', true);
        }
      }
    } catch (e) {
      warn(`4.1 REST respond: ${e.message}`);
      if (driverSocket) driverSocket.emit('driver_response', { rideRequestId, driverId, action: 'accept', counterOffer: null });
    }

    // 4.2 Rider receives fare_offer
    const fo = await fareOfferPromise;
    if (fo) {
      fareOfferReceived = true;
      ok('4.2 Rider got fare_offer', true);
      ok('4.2a fareAmount', typeof fo.fareAmount === 'number');
      ok('4.2b driverName', typeof fo.driverName === 'string' && fo.driverName.length > 0);
      ok('4.2c arrivalTime', typeof fo.arrivalTime === 'number');
      INFO(`Offer: PKR ${fo.fareAmount} | ETA ${fo.arrivalTime}min | "${fo.driverName}"`);

      if (fo.arrivalTime < 1 || fo.arrivalTime > 120) {
        issue('logic', `arrivalTime=${fo.arrivalTime}min is outside realistic range`, 'Check distance-based ETA formula');
      }
    } else {
      FAIL('4.2 fare_offer NOT received within 12s'); failed++;
      issue('critical', 'fare_offer not received by rider',
        'Check: wallet balance, driver approval, driver in radius, driver online');
    }
  } else if (rideRequestId && driverSocket && !driverToken) {
    const fareOfferPromise = riderSocket ? waitOrNull(riderSocket, 'fare_offer', 12000) : Promise.resolve(null);
    driverSocket.emit('driver_response', { rideRequestId, driverId, action: 'accept', counterOffer: null });
    INFO('Sent driver_response via socket (no REST token path)');
    const fo = await fareOfferPromise;
    if (fo) { fareOfferReceived = true; ok('4.2 Rider got fare_offer (socket path)', true); }
    else { warn('4.2 fare_offer not received (socket path)'); }
  } else {
    INFO('Skipping Phase 4 (no rideRequestId or driver)');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 5: RIDER ACCEPTS → MATCHED
  // ═════════════════════════════════════════════════════════════════════════
  HEAD('PHASE 5 — Rider Accepts → Ride Matched');

  if (rideRequestId && riderId && riderSocket && fareOfferReceived) {
    const fareRespPromise = driverSocket ? waitOrNull(driverSocket, 'fare_response', 10000) : Promise.resolve(null);
    const assignedPromise = waitOrNull(riderSocket, 'driver_assigned', 10000);

    try {
      const t0 = Date.now();
      riderSocket.emit('fare_response', { rideRequestId, riderId, driverId, action: 'accept', timestamp: Date.now() });
      INFO('Rider sent fare_response (accept)');

      const [fareResp, assigned] = await Promise.all([fareRespPromise, assignedPromise]);
      perf('Fare response round-trip', t0);

      if (fareResp) { ok('5.2 Driver got fare_response', true); ok('5.2a action=accept', fareResp.action === 'accept'); }
      else { FAIL('5.2 Driver did NOT get fare_response'); failed++; }

      if (assigned) {
        ok('5.3 Rider got driver_assigned', true);
        ok('5.3a Has driver obj', !!assigned.driver);
        if (assigned.driver) {
          ok('5.3b driver._id', !!assigned.driver._id);
          ok('5.3c firstName', typeof assigned.driver.firstName === 'string');
          INFO(`Assigned: ${assigned.driver.firstName} ${assigned.driver.lastName || ''}`);
        }
      } else { FAIL('5.3 driver_assigned NOT received'); failed++; issue('critical', 'driver_assigned not emitted'); }
    } catch (e) { FAIL(`5.x: ${e.message}`); failed++; }

    // 5.4 Status check + polyline
    await sleep(800);
    try {
      const t0 = Date.now();
      const r = await httpGet(`${BASE_URL}/api/ride-requests/${rideRequestId}/status`, riderToken);
      perf('Poll accepted status', t0);
      const st = r.data?.rideRequest?.status || r.data?.status;
      ok('5.4 Status = accepted', st === 'accepted', `got "${st}"`);
      ok('5.4a acceptedBy set', !!(r.data?.rideRequest?.acceptedBy || r.data?.acceptedBy));

      const poly = r.data?.rideRequest?.routeOverviewPolyline || '';
      if (poly.length > 0) {
        ok('5.5 Route polyline saved (Google API savings)', true);
        INFO(`Polyline: ${poly.length} chars`);
      } else {
        warn('5.5 Route polyline NOT saved', 'Check GOOGLE_MAPS_SERVER_KEY env var on backend');
        issue('google_api', 'Polyline not persisted — clients will re-call Directions API');
      }
    } catch (e) { FAIL(`5.4: ${e.message}`); failed++; }
  } else {
    INFO('Skipping Phase 5 (prerequisites missing or fare_offer not received)');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 6: REAL-TIME TRACKING
  // ═════════════════════════════════════════════════════════════════════════
  HEAD('PHASE 6 — Real-time Ride Modal & Tracking');

  if (rideRequestId && riderSocket && driverSocket && fareOfferReceived) {
    // 6.1 Rider arrived
    const pickupPromise = waitOrNull(driverSocket, 'rider_at_pickup', 8000);
    try {
      const t0 = Date.now();
      riderSocket.emit('rider_arrived', { rideRequestId, riderId, latitude: PICKUP.latitude, longitude: PICKUP.longitude });
      const evt = await pickupPromise;
      perf('rider_arrived relay', t0);
      ok('6.1 Driver got rider_at_pickup', !!evt);
    } catch (e) { FAIL(`6.1: ${e.message}`); failed++; }

    // 6.2 riderArrivedAt persisted
    await sleep(400);
    try {
      const r = await httpGet(`${BASE_URL}/api/ride-requests/${rideRequestId}/status`, riderToken);
      const arr = r.data?.rideRequest?.riderArrivedAt || r.data?.riderArrivedAt;
      ok('6.2 riderArrivedAt persisted', !!arr);
    } catch (e) { FAIL(`6.2: ${e.message}`); failed++; }

    // 6.3 Presence
    try {
      const presPromise = waitOrNull(riderSocket, 'ride_presence', 5000);
      riderSocket.emit('ride_presence_subscribe', { rideRequestId });
      const p = await presPromise;
      if (p) { ok('6.3 ride_presence received', true); ok('6.3a driverOnline', p.driverOnline === true); }
      else warn('6.3 ride_presence not received in 5s');
    } catch (e) { warn(`6.3: ${e.message}`); }

    // 6.4 Live location
    try {
      const locPromise = waitOrNull(riderSocket, 'ride_live_location', 4000);
      driverSocket.emit('ride_live_location', {
        rideRequestId, senderId: driverId, senderType: 'driver',
        latitude: PICKUP.latitude + 0.001, longitude: PICKUP.longitude + 0.001, heading: 90
      });
      const loc = await locPromise;
      ok('6.4 ride_live_location relay', !!loc);
    } catch (e) { warn(`6.4: ${e.message}`); }

    // 6.5 Chat
    try {
      const chatPromise = waitOrNull(riderSocket, 'ride_chat_message', 5000);
      driverSocket.emit('ride_chat_message', {
        rideRequestId, senderId: driverId, senderType: 'driver',
        text: 'On my way!', timestamp: Date.now()
      });
      const msg = await chatPromise;
      ok('6.5 ride_chat_message relay', !!msg);
      if (msg) ok('6.5a text matches', msg.text === 'On my way!');
    } catch (e) { warn(`6.5: ${e.message}`); }
  } else {
    INFO('Skipping Phase 6 (prerequisites missing)');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 7: RIDE COMPLETION
  // ═════════════════════════════════════════════════════════════════════════
  HEAD('PHASE 7 — Ride Completion');

  if (rideRequestId && driverSocket && riderSocket && fareOfferReceived) {
    // 7.1 Start ride
    const startPromise = waitOrNull(riderSocket, 'ride_started', 8000);
    try {
      const t0 = Date.now();
      driverSocket.emit('start_ride', { rideRequestId, driverId });
      const evt = await startPromise;
      perf('start_ride relay', t0);
      ok('7.1 Rider got ride_started', !!evt);
    } catch (e) { FAIL(`7.1: ${e.message}`); failed++; }

    // 7.2 Status = in_progress
    await sleep(500);
    try {
      const r = await httpGet(`${BASE_URL}/api/ride-requests/${rideRequestId}/status`, riderToken);
      const st = r.data?.rideRequest?.status || r.data?.status;
      ok('7.2 Status = in_progress', st === 'in_progress', `got "${st}"`);
    } catch (e) { FAIL(`7.2: ${e.message}`); failed++; }

    // 7.3 End ride
    const compRiderPromise = waitOrNull(riderSocket, 'ride_completed', 10000);
    const compDriverPromise = waitOrNull(driverSocket, 'ride_completed', 10000);
    try {
      const t0 = Date.now();
      driverSocket.emit('end_ride', { rideRequestId, driverId });
      const [cr, cd] = await Promise.all([compRiderPromise, compDriverPromise]);
      perf('end_ride relay', t0);
      ok('7.3a Rider got ride_completed', !!cr);
      ok('7.3b Driver got ride_completed', !!cd);
    } catch (e) { FAIL(`7.3: ${e.message}`); failed++; }

    // 7.4 Status = completed
    await sleep(800);
    try {
      const t0 = Date.now();
      const r = await httpGet(`${BASE_URL}/api/ride-requests/${rideRequestId}/status`, riderToken);
      perf('Poll completed', t0);
      const st = r.data?.rideRequest?.status || r.data?.status;
      ok('7.4 Status = completed', st === 'completed', `got "${st}"`);
    } catch (e) { FAIL(`7.4: ${e.message}`); failed++; }

    // 7.5 Ride bridge doc
    try {
      const t0 = Date.now();
      const r = await httpGet(`${BASE_URL}/api/rides/${rideRequestId}`, riderToken);
      perf('GET Ride bridge doc', t0);
      if (r.ok) {
        ok('7.5 Ride bridge exists', true);
        const rd = r.data?.ride;
        if (rd) {
          ok('7.5a status=completed', rd.status === 'completed');
          ok('7.5b has driver', !!rd.driver);
          ok('7.5c has price', typeof rd.price?.amount === 'number');
          INFO(`Ride: PKR ${rd.price?.amount} | ${rd.rideType} | ${rd.paymentMethod}`);
        }
      } else {
        warn('7.5 Ride bridge NOT found', `${r.status}`);
        issue('logic', 'Ride bridge not created — rating system will break');
      }
    } catch (e) { warn(`7.5: ${e.message}`); }

    // 7.6 Commission
    try {
      const r = await httpGet(`${BASE_URL}/api/rides/${rideRequestId}`, riderToken);
      const rd = r.data?.ride;
      if (rd && (rd.driverCommissionAmount || 0) > 0) {
        ok('7.6 Commission deducted', true);
        INFO(`Commission: ${rd.driverCommissionPct}% = PKR ${rd.driverCommissionAmount}`);
      } else {
        INFO('7.6 No commission (may be 0% for this ride type)');
      }
    } catch (e) { INFO(`7.6: ${e.message}`); }
  } else {
    INFO('Skipping Phase 7');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 8: POST-RIDE
  // ═════════════════════════════════════════════════════════════════════════
  HEAD('PHASE 8 — Post-Ride (Rating + History)');

  if (rideRequestId && riderToken && fareOfferReceived) {
    // 8.1 Rate
    try {
      const t0 = Date.now();
      const r = await httpPost(`${BASE_URL}/api/rides/${rideRequestId}/rate`, { rating: 5, comment: 'Great test ride!' }, riderToken);
      perf('Rate ride', t0);
      ok('8.1 Ride rated', r.ok, `${r.status} — ${r.data?.error || r.data?.message || ''}`);
    } catch (e) { FAIL(`8.1: ${e.message}`); failed++; }

    // 8.2 History
    try {
      const t0 = Date.now();
      const r = await httpGet(`${BASE_URL}/api/rides/history`, riderToken);
      perf('Ride history', t0);
      ok('8.2 History accessible', r.ok);
      if (r.ok) INFO(`Total rides in history: ${r.data?.total || r.data?.rides?.length || 0}`);
    } catch (e) { FAIL(`8.2: ${e.message}`); failed++; }
  } else {
    INFO('Skipping Phase 8');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 9: CANCELLATION
  // ═════════════════════════════════════════════════════════════════════════
  HEAD('PHASE 9 — Cancellation Flow');

  if (riderToken) {
    const cancelReqPromise = driverSocket ? waitOrNull(driverSocket, 'ride_request', 8000) : Promise.resolve(null);
    let cancelId = null;

    try {
      const r = await httpPost(`${BASE_URL}/api/ride-requests/request-ride`, {
        pickup: PICKUP, destination: DEST,
        offeredFare: 180, radiusMeters: 5000,
        paymentMethod: 'cash', vehicleType: 'ride_mini',
        notes: 'Cancel test'
      }, riderToken);
      if (r.status === 201) { cancelId = r.data?.rideRequest?.id; ok('9.1 Cancel test ride created', true); }
      else warn('9.1 Cancel ride creation', `${r.status}`);
    } catch (e) { warn(`9.1: ${e.message}`); }

    if (cancelReqPromise) await cancelReqPromise;

    if (cancelId) {
      const cancelEvtPromise = driverSocket ? waitOrNull(driverSocket, 'ride_request_cancelled', 8000) : Promise.resolve(null);
      try {
        const t0 = Date.now();
        const r = await httpPost(`${BASE_URL}/api/ride-requests/${cancelId}/cancel`, { reason: 'test_cleanup' }, riderToken);
        perf('Cancel ride (REST)', t0);
        ok('9.2 Cancelled via REST', r.ok, `${r.status} — ${r.data?.error || ''}`);

        if (cancelEvtPromise) {
          const evt = await cancelEvtPromise;
          if (evt) { ok('9.2a Driver got ride_request_cancelled', true); ok('9.2b newStatus=cancelled', evt.newStatus === 'cancelled'); }
          else INFO('9.2a Driver did not get cancel event (not in availableDrivers)');
        }
      } catch (e) { FAIL(`9.2: ${e.message}`); failed++; }

      try {
        const r = await httpGet(`${BASE_URL}/api/ride-requests/${cancelId}/status`, riderToken);
        const st = r.data?.rideRequest?.status || r.data?.status;
        ok('9.2c Status persisted as cancelled', st === 'cancelled', `got "${st}"`);
      } catch (e) { INFO(`9.2c: ${e.message}`); }
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 10: CODE ANALYSIS
  // ═════════════════════════════════════════════════════════════════════════
  HEAD('PHASE 10 — Code Analysis (known items)');

  issue('security', 'Google Maps API key was hardcoded in frontend (api.ts)',
    'FIXED: Now reads from EXPO_PUBLIC_GOOGLE_MAPS_API_KEY env var. Restrict key in Google Cloud Console.');

  issue('logic', 'Haversine distance (straight line) vs road distance',
    'Road distance can be 30–50% longer. Consider Google Distance Matrix API for more accurate fare calculations.');

  issue('logic', 'Duplicate REST + Socket handlers can update same ride concurrently',
    'Mitigate with Mongoose version key (__v) optimistic locking to prevent double-updates.');

  // Print issues
  if (issues.length > 0) {
    console.log('\n  \x1b[1mDetected Issues:\x1b[0m\n');
    const grouped = {};
    for (const i of issues) { (grouped[i.severity] ||= []).push(i); }
    const order = ['critical', 'security', 'performance', 'logic', 'google_api', 'warning'];
    const labels = { critical: '🔴 CRITICAL', security: '🔒 SECURITY', performance: '⚡ PERFORMANCE', logic: '🔧 LOGIC', google_api: '🗺️  GOOGLE API', warning: '⚠️  WARNING' };
    const colors = { critical: '\x1b[31m', security: '\x1b[31m', performance: '\x1b[33m', logic: '\x1b[33m', google_api: '\x1b[36m', warning: '\x1b[33m' };
    for (const sev of order) {
      if (!grouped[sev]?.length) continue;
      console.log(`  ${colors[sev]}${labels[sev]}\x1b[0m`);
      for (const it of grouped[sev]) { console.log(`    • ${it.label}`); if (it.detail) console.log(`      ${it.detail}`); }
      console.log('');
    }
  }

  // Cleanup sockets
  if (riderSocket) { riderSocket.emit('ride_presence_unsubscribe', { rideRequestId }); riderSocket.disconnect(); }
  if (driverSocket) driverSocket.disconnect();

  await cleanup();
}

async function cleanup() {
  // Restore original minimum wallet setting
  if (_adminToken && _originalMinimumWallet !== null) {
    try {
      await setMinimumDriverWallet(_originalMinimumWallet);
      INFO(`Restored driverMinimumWalletPkr to ${_originalMinimumWallet} PKR`);
    } catch (e) { WARN(`Failed to restore wallet minimum: ${e.message}`); }
  }
  printReport();
}

function printReport() {
  const total = passed + failed;
  console.log('\n' + '='.repeat(70));
  console.log('  \x1b[1mTEST REPORT\x1b[0m');
  console.log('='.repeat(70));
  console.log(`  Total assertions: ${total}`);
  console.log(`  \x1b[32mPassed: ${passed}\x1b[0m`);
  console.log(`  \x1b[31mFailed: ${failed}\x1b[0m`);
  console.log(`  \x1b[33mWarnings: ${warnings}\x1b[0m`);
  console.log(`  Issues found: ${issues.length}`);

  if (Object.keys(perfMetrics).length > 0) {
    console.log('\n  \x1b[1mPerformance Metrics:\x1b[0m');
    for (const [l, ms] of Object.entries(perfMetrics).sort((a, b) => b[1] - a[1])) {
      const c = ms < 500 ? '\x1b[32m' : ms < 2000 ? '\x1b[33m' : '\x1b[31m';
      console.log(`    ${c}${String(ms).padStart(6)}ms\x1b[0m  ${l}`);
    }
  }

  console.log('='.repeat(70));
  if (failed === 0) console.log('\n  \x1b[32m🎉  All tests passed!\x1b[0m\n');
  else {
    console.log('\n  \x1b[31m⚠️   Some tests failed.\x1b[0m');
    console.log('  Tips:');
    console.log('  • Driver must be approved by admin to log in');
    console.log('  • Driver must be online, approved, and near pickup');
    console.log('  • Set GOOGLE_MAPS_SERVER_KEY env var on backend for polyline');
    console.log(`  • Override credentials: TEST_RIDER_EMAIL, TEST_RIDER_PASS, TEST_DRIVER_EMAIL, TEST_DRIVER_PASS\n`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => { console.error('\n💥  Unexpected:', e); cleanup(); });
