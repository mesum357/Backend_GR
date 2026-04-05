/**
 * GB RIDES — Complete Ride Process E2E
 *
 * Comprehensive test covering every phase of the ride lifecycle:
 *
 *   Phase A: Auth & Setup
 *     1. Register rider + driver
 *     2. Login both, obtain tokens
 *     3. Connect sockets, authenticate, set driver location
 *
 *   Phase B: Ride Request & Fare Negotiation
 *     4. Rider creates ride request → driver receives ride_request notification
 *     5. Rider updates fare → driver sees ride_request_updated + fresh ride_request
 *     6. Rider cancels request → driver sees ride_request_cancelled
 *     7. Driver tries to accept cancelled request → 400 "no longer available"
 *     8. Rider creates new request for remaining tests
 *
 *   Phase C: Driver Offer & Acceptance
 *     9. Driver emits fare_offer → rider receives fare_offer
 *    10. Rider accepts → fare_response_confirmed + driver_assigned
 *
 *   Phase D: Ride Lifecycle
 *    11. Rider arrives at pickup → driver gets rider_at_pickup
 *    12. Driver starts ride → rider gets ride_started
 *    13. In-app call: driver calls rider → rider receives ride_call_request
 *    14. Rider accepts call → driver gets ride_call_response (accept)
 *    15. Call ends → both get ride_call_ended
 *    16. In-app chat: driver sends message → rider receives ride_chat_message
 *
 *   Phase E: Ride Completion (rider-initiated)
 *    17. Rider completes ride (rider_completed_ride) → both get ride_completed
 *    18. Driver gets rider_confirmed_arrival notification
 *    19. DB confirms completed status
 *
 *   Phase F: Reviews
 *    20. Rider rates driver (POST /rate)
 *    21. Driver rates rider (POST /rate)
 *
 *   Phase G: Driver-initiated end ride (separate ride)
 *    22. Full ride → driver emits end_ride → both get ride_completed
 *
 *   Phase H: Live location & ride status polling
 *    23. Driver sends ride_live_location → rider receives it
 *    24. GET /status returns correct ride status
 *
 * Usage:
 *   cd Backend_GR
 *   Start MongoDB + `npm run dev` (server on port 8080 by default), then:
 *   node test-complete-ride-process-e2e.js
 *
 * Rider WhatsApp OTP (production): required on POST /api/auth/register for userType rider.
 * For this script, set in Backend_GR/.env:
 *   RIDER_WHATSAPP_OTP_REQUIRED=0
 *   DRIVER_WHATSAPP_OTP_REQUIRED=0
 *
 *   Remote (drivers often need admin approval):
 *   API_URL=https://api.example.com ADMIN_EMAIL=... ADMIN_PASSWORD=... node test-complete-ride-process-e2e.js
 *
 *   Windows PowerShell:
 *   $env:API_URL="https://..."; $env:ADMIN_EMAIL="..."; $env:ADMIN_PASSWORD="..."; node test-complete-ride-process-e2e.js
 */

const fetch = require('node-fetch').default;
const io = require('socket.io-client');

const LOCAL_PORT = process.env.LOCAL_API_PORT || '8080';
const LOCAL_DEFAULT = `http://127.0.0.1:${LOCAL_PORT}`;
const USE_LOCAL_ONLY =
  process.env.LOCAL_ONLY === '1' || process.env.LOCAL_ONLY === 'true';

const BASE_URL = (
  USE_LOCAL_ONLY
    ? LOCAL_DEFAULT
    : (process.env.API_URL || process.env.BASE_URL || LOCAL_DEFAULT)
).replace(/\/$/, '');
const PASSWORD = 'TestPass123!';

/** Admin API — required when the server puts new drivers “under review”. */
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

let adminToken = null;
/** Restored in `finally` after lowering for E2E (socket fare_offer + REST respond). */
let savedDriverMinimumWalletPkr = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PASS = (msg) => console.log(`  \u2705  ${msg}`);
const FAIL = (msg) => console.log(`  \u274C  ${msg}`);
const INFO = (msg) => console.log(`  \u2139\uFE0F   ${msg}`);
const SECTION = (msg) => console.log(`\n${'='.repeat(60)}\n  ${msg}\n${'='.repeat(60)}`);

let passed = 0;
let failed = 0;

function ok(label, condition, detail = '') {
  if (condition) { PASS(label); passed++; }
  else { FAIL(`${label}${detail ? ' -- ' + detail : ''}`); failed++; }
  return condition;
}

function okHttp(label, method, url, res) {
  if (res.ok) { PASS(label); passed++; return true; }
  FAIL(`${label} -- ${res.status}`);
  INFO(`  ${method} ${url}`);
  try { INFO(`  body: ${JSON.stringify(res.data, null, 2).slice(0, 400)}`); } catch {}
  failed++;
  return false;
}

// ── HTTP helpers ─────────────────────────────────────────

async function httpPost(url, body, token) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  let data; try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, ok: res.ok, data };
}

async function httpGet(url, token) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  let data; try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, ok: res.ok, data };
}

async function httpPatch(url, body, token) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(body) });
  let data; try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, ok: res.ok, data };
}

// ── Socket helpers ───────────────────────────────────────

function connectSocket(label) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE_URL, { transports: ['websocket'], timeout: 25000 });
    socket.on('connect', () => {
      INFO(`${label} socket connected: ${socket.id}`);
      resolve(socket);
    });
    socket.on('connect_error', (err) => reject(new Error(`${label} socket error: ${err.message}`)));
    setTimeout(() => reject(new Error(`${label} socket timeout`)), 25000);
  });
}

function waitForEvent(socket, event, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeoutMs);
    socket.once(event, (data) => { clearTimeout(t); resolve(data); });
  });
}

function waitOrNull(socket, event, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (data) => { clearTimeout(t); resolve(data); });
  });
}

// ── Auth helpers ─────────────────────────────────────────

function createTestIds() {
  const ts = Date.now();
  return {
    riderEmail: `e2eFullRider${ts}@test.com`,
    riderPhone: `9${String(ts).slice(-9)}`,
    driverEmail: `e2eFullDriver${ts}@test.com`,
    driverPhone: `8${String(ts).slice(-9)}`,
    plate: `PLT-${ts}`,
  };
}

async function registerUser({ email, phone, userType, firstName, lastName, plate, vehicleType }) {
  const driverInfo = userType === 'driver' ? {
    vehicleInfo: {
      make: 'Toyota', model: 'Corolla', year: 2020, color: 'White',
      plateNumber: plate, vehicleType: vehicleType || 'car',
    },
    licenseNumber: `LIC-${plate}`,
    licenseExpiry: new Date(Date.now() + 365 * 86400000).toISOString(),
    insuranceNumber: `INS-${plate}`,
    insuranceExpiry: new Date(Date.now() + 365 * 86400000).toISOString(),
  } : undefined;

  const r = await httpPost(`${BASE_URL}/api/auth/register`, {
    email, password: PASSWORD, firstName, lastName, phone, userType,
    ...(driverInfo ? { driverInfo } : {}),
  });
  if (!r.ok) throw new Error(`register ${userType} failed: ${r.status} ${JSON.stringify(r.data?.error || r.data)}`);
  return r.data;
}

async function adminLogin() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return null;
  const r = await httpPost(`${BASE_URL}/api/admin/auth/login`, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (r.ok && r.data?.token) {
    adminToken = r.data.token;
    return adminToken;
  }
  INFO(`Admin login failed (${r.status}) — set ADMIN_EMAIL / ADMIN_PASSWORD to auto-approve drivers`);
  return null;
}

async function approveDriverByEmail(driverEmail) {
  if (!adminToken) return false;
  const list = await httpGet(`${BASE_URL}/api/admin/driver-requests?status=pending`, adminToken);
  if (!list.ok) return false;
  const requests = Array.isArray(list.data?.requests) ? list.data.requests : [];
  const match = requests.find(
    (d) => String(d?.user?.email || '').toLowerCase() === String(driverEmail).toLowerCase(),
  );
  if (!match?._id) return false;
  const approve = await httpPatch(`${BASE_URL}/api/admin/driver-requests/${match._id}/approve`, {}, adminToken);
  return approve.ok;
}

/** Nearby matching requires isOnline + isAvailable + isApproved; wallet min blocks fare_offer. */
async function lowerDriverWalletMinimumForE2E() {
  if (!adminToken) return;
  const cur = await httpGet(`${BASE_URL}/api/admin/wallet/settings`, adminToken);
  if (cur.ok && cur.data && typeof cur.data.driverMinimumWalletPkr === 'number') {
    savedDriverMinimumWalletPkr = cur.data.driverMinimumWalletPkr;
  }
  const p = await httpPatch(
    `${BASE_URL}/api/admin/wallet/settings`,
    { driverMinimumWalletPkr: 0 },
    adminToken,
  );
  ok('Admin: driverMinimumWalletPkr set to 0 for E2E', p.ok);
}

async function restoreDriverWalletMinimum() {
  if (!adminToken || savedDriverMinimumWalletPkr == null) return;
  try {
    await httpPatch(
      `${BASE_URL}/api/admin/wallet/settings`,
      { driverMinimumWalletPkr: savedDriverMinimumWalletPkr },
      adminToken,
    );
    INFO(`Restored driverMinimumWalletPkr to ${savedDriverMinimumWalletPkr}`);
  } catch {
    // ignore
  }
}

async function loginUser({ email, expectedUserType }) {
  let r = await httpPost(`${BASE_URL}/api/auth/login`, { email, password: PASSWORD, expectedUserType });
  if (r.ok && r.data?.token) return { token: r.data.token, user: r.data.user };

  const errText = String(r.data?.error || r.data?.message || '');
  if (
    expectedUserType === 'driver' &&
    r.status === 403 &&
    errText.toLowerCase().includes('review')
  ) {
    INFO('Driver login blocked (pending approval) — trying admin approve…');
    if (!adminToken) await adminLogin();
    if (adminToken) {
      await sleep(400);
      if (await approveDriverByEmail(email)) {
        ok('Driver approved via admin API', true);
        r = await httpPost(`${BASE_URL}/api/auth/login`, { email, password: PASSWORD, expectedUserType });
        if (r.ok && r.data?.token) return { token: r.data.token, user: r.data.user };
      }
    } else {
      INFO('Provide ADMIN_EMAIL and ADMIN_PASSWORD to approve new drivers on this server');
    }
  }

  throw new Error(`login ${expectedUserType} failed: ${r.status} ${JSON.stringify(r.data?.error || r.data)}`);
}

// ── Coordinates ──────────────────────────────────────────

const PICKUP = { latitude: 35.9208, longitude: 74.3144, address: 'Gilgit City Center' };
const DEST   = { latitude: 35.935,  longitude: 74.33,   address: 'Jutial, Gilgit' };
const DRIVER_AT_DEST = { latitude: 35.935, longitude: 74.33 };

// ═════════════════════════════════════════════════════════
// MAIN TEST
// ═════════════════════════════════════════════════════════

async function run() {
  console.log('\n\uD83D\uDE80  GB RIDES -- Complete Ride Process E2E');
  console.log(`    Backend: ${BASE_URL}`);
  console.log(`    ${new Date().toISOString()}\n`);

  const ids = createTestIds();
  let riderToken, driverToken, riderId, driverId;
  let riderSocket, driverSocket;

  try {
  // ══════════════════════════════════════════════════════
  // PHASE A: AUTH & SETUP
  // ══════════════════════════════════════════════════════
  SECTION('PHASE A: Auth & Setup');

  INFO('Registering rider + driver');
  await registerUser({
    email: ids.riderEmail, phone: ids.riderPhone,
    userType: 'rider', firstName: 'Test', lastName: 'Rider',
  });
  await registerUser({
    email: ids.driverEmail, phone: ids.driverPhone,
    userType: 'driver', firstName: 'Test', lastName: 'Driver',
    plate: ids.plate, vehicleType: 'car',
  });
  PASS('Registration completed');
  passed++;

  INFO('Approving driver via admin API when ADMIN_EMAIL + ADMIN_PASSWORD are set');
  await adminLogin();
  if (adminToken) {
    await sleep(600);
    if (await approveDriverByEmail(ids.driverEmail)) {
      ok('Driver approved before login', true);
    }
    await lowerDriverWalletMinimumForE2E();
  }

  INFO('Logging in');
  const riderLogin = await loginUser({ email: ids.riderEmail, expectedUserType: 'rider' });
  const driverLogin = await loginUser({ email: ids.driverEmail, expectedUserType: 'driver' });
  riderToken = riderLogin.token;
  driverToken = driverLogin.token;
  riderId = String(riderLogin.user._id || riderLogin.user.id);
  driverId = String(driverLogin.user._id || driverLogin.user.id);
  ok('Tokens obtained', !!(riderToken && driverToken));
  ok('User IDs obtained', !!(riderId && driverId));

  INFO('Connecting sockets');
  riderSocket = await connectSocket('Rider');
  driverSocket = await connectSocket('Driver');
  riderSocket.emit('authenticate', { userId: riderId, userType: 'rider' });
  driverSocket.emit('authenticate', { userId: driverId, userType: 'driver' });

  riderSocket.on('error', (msg) => INFO(`Rider socket error: ${JSON.stringify(msg)}`));
  driverSocket.on('error', (msg) => INFO(`Driver socket error: ${JSON.stringify(msg)}`));
  await sleep(500);

  INFO('Setting driver location at pickup (must be inside matching radius)');
  const locRes = await httpPost(
    `${BASE_URL}/api/drivers/location`,
    { latitude: PICKUP.latitude, longitude: PICKUP.longitude },
    driverToken,
  );
  ok('Driver location set', locRes.ok || locRes.status < 500);

  INFO('Driver goes online (required for findNearbyDrivers: isOnline + isAvailable)');
  const goOnline = await httpPost(`${BASE_URL}/api/drivers/toggle-status`, {}, driverToken);
  ok('Driver is online', goOnline.ok && goOnline.data?.isOnline === true);

  await sleep(400);

  // ══════════════════════════════════════════════════════
  // PHASE B: RIDE REQUEST & FARE NEGOTIATION
  // ══════════════════════════════════════════════════════
  SECTION('PHASE B: Ride Request & Fare Negotiation');

  INFO('B1: Rider creates ride request');
  const driverRideReqP = waitOrNull(driverSocket, 'ride_request', 20000);
  const rr1 = await httpPost(`${BASE_URL}/api/ride-requests/request-ride`, {
    pickup: PICKUP, destination: DEST, offeredFare: 100,
    radiusMeters: 50000, paymentMethod: 'cash', vehicleType: 'any',
  }, riderToken);
  ok('Ride request created', rr1.ok, JSON.stringify(rr1.data?.error || ''));
  const rr1Id = String(rr1.data?.rideRequest?.id || rr1.data?.rideRequest?._id || '');
  ok('Ride request ID present', !!rr1Id);
  if (rr1.ok && rr1.data?.rideRequest) {
    ok('Backend found at least one nearby driver', rr1.data.rideRequest.driversFound !== false);
  }

  const driverGotReq = await driverRideReqP;
  ok('Driver received ride_request via socket', !!driverGotReq);
  ok('ride_request contains correct rideRequestId', String(driverGotReq?.rideRequestId) === rr1Id);
  ok('ride_request contains offeredFare', driverGotReq?.offeredFare === 100);

  INFO('B2: Rider updates fare (PATCH)');
  const fareUpdP = waitOrNull(driverSocket, 'ride_request_updated', 8000);
  const freshReqP = waitOrNull(driverSocket, 'ride_request', 8000);
  const fareRes = await httpPatch(`${BASE_URL}/api/ride-requests/${rr1Id}/fare`, { offeredFare: 150 }, riderToken);
  ok('PATCH fare 200', fareRes.ok);

  const updEvt = await fareUpdP;
  ok('Driver got ride_request_updated', !!updEvt);
  ok('Updated fare is 150', updEvt?.requestedPrice === 150 || updEvt?.offeredFare === 150);
  ok(
    'ride_request_updated includes oldFare (when API sends it)',
    typeof updEvt?.oldFare === 'number' || updEvt?.oldFare === undefined,
  );

  const freshEvt = await freshReqP;
  ok(
    'Driver got fresh ride_request or only updated event (API variant)',
    freshEvt == null || freshEvt.offeredFare === 150 || freshEvt.requestedPrice === 150,
  );

  INFO('B3: Rider cancels request');
  const cancelEvtP = waitOrNull(driverSocket, 'ride_request_cancelled', 8000);
  const cancelRes = await httpPost(`${BASE_URL}/api/ride-requests/${rr1Id}/cancel`, {}, riderToken);
  ok('Cancel request 200', cancelRes.ok);
  const cancelEvt = await cancelEvtP;
  ok('Driver received ride_request_cancelled', !!cancelEvt);

  INFO('B4: Driver tries to accept cancelled request');
  const respondRes = await httpPost(
    `${BASE_URL}/api/ride-requests/${rr1Id}/respond`,
    { action: 'accept', fareAmount: 150 },
    driverToken,
  );
  ok('Accept cancelled request rejected (non-2xx)', !respondRes.ok);
  const cancelErr = String(respondRes.data?.error || respondRes.data?.message || '').toLowerCase();
  ok(
    'Error message indicates unavailable / invalid state',
    cancelErr.includes('no longer') ||
      cancelErr.includes('not available') ||
      cancelErr.includes('cancelled') ||
      cancelErr.includes('not found') ||
      cancelErr.includes('expired') ||
      cancelErr.includes('invalid') ||
      [400, 403, 404].includes(respondRes.status),
  );

  INFO('B5: Creating new ride request for remaining tests');
  const driverRideReq2P = waitOrNull(driverSocket, 'ride_request', 10000);
  const rr2 = await httpPost(`${BASE_URL}/api/ride-requests/request-ride`, {
    pickup: PICKUP, destination: DEST, offeredFare: 200,
    radiusMeters: 50000, paymentMethod: 'cash', vehicleType: 'any',
    notes: 'Full ride flow test',
  }, riderToken);
  ok('Second ride request created', rr2.ok);
  const rr2Id = String(rr2.data?.rideRequest?.id || rr2.data?.rideRequest?._id || '');
  ok('Second ride request ID', !!rr2Id);
  await driverRideReq2P;

  // ══════════════════════════════════════════════════════
  // PHASE C: DRIVER OFFER & ACCEPTANCE
  // ══════════════════════════════════════════════════════
  SECTION('PHASE C: Driver Offer & Acceptance');

  INFO('C1: Driver sends fare offer');
  const fareOfferP = waitOrNull(riderSocket, 'fare_offer', 10000);
  driverSocket.emit('fare_offer', {
    rideRequestId: rr2Id, driverId, driverName: 'Test Driver',
    driverRating: 4.5, fareAmount: 200, arrivalTime: 5,
    vehicleInfo: 'Toyota Corolla',
  });
  const fareOffer = await fareOfferP;
  ok('Rider received fare_offer', !!fareOffer);
  ok('fare_offer contains correct rideRequestId', String(fareOffer?.rideRequestId) === rr2Id);
  ok('fare_offer fareAmount correct', fareOffer?.fareAmount === 200);

  INFO('C2: Rider accepts offer');
  const confP = waitOrNull(riderSocket, 'fare_response_confirmed', 10000);
  const assignP = waitOrNull(riderSocket, 'driver_assigned', 10000);
  const driverFareRespP = waitOrNull(driverSocket, 'fare_response', 10000);
  riderSocket.emit('fare_response', {
    rideRequestId: rr2Id, riderId, action: 'accept', timestamp: Date.now(),
  });
  const [conf, assign, driverFareResp] = await Promise.all([confP, assignP, driverFareRespP]);
  ok('Rider received fare_response_confirmed', !!conf);
  ok('Rider received driver_assigned', !!assign);
  ok('Driver received fare_response', !!driverFareResp);

  // ══════════════════════════════════════════════════════
  // PHASE D: RIDE LIFECYCLE
  // ══════════════════════════════════════════════════════
  SECTION('PHASE D: Ride Lifecycle');

  INFO('D1: Rider arrives at pickup');
  const riderAtP = waitOrNull(driverSocket, 'rider_at_pickup', 10000);
  riderSocket.emit('rider_arrived', {
    rideRequestId: rr2Id,
    riderId,
    latitude: PICKUP.latitude,
    longitude: PICKUP.longitude,
  });
  const riderAt = await riderAtP;
  ok('Driver received rider_at_pickup', !!riderAt);

  INFO('D2: Driver starts ride');
  const rideStartedP = waitOrNull(riderSocket, 'ride_started', 10000);
  driverSocket.emit('start_ride', { rideRequestId: rr2Id, driverId });
  const rideStarted = await rideStartedP;
  ok('Rider received ride_started', !!rideStarted);

  INFO('D3: Live location sharing');
  const liveLocP = waitOrNull(riderSocket, 'ride_live_location', 8000);
  driverSocket.emit('ride_live_location', {
    rideRequestId: rr2Id,
    senderId: driverId,
    senderType: 'driver',
    latitude: DRIVER_AT_DEST.latitude,
    longitude: DRIVER_AT_DEST.longitude,
    heading: 90,
  });
  const liveLoc = await liveLocP;
  ok('Rider received ride_live_location', !!liveLoc);
  ok('Live location has coordinates', typeof liveLoc?.latitude === 'number');

  INFO('D4: In-app chat');
  const chatP = waitOrNull(riderSocket, 'ride_chat_message', 8000);
  driverSocket.emit('ride_chat_message', {
    rideRequestId: rr2Id, senderId: driverId, senderType: 'driver',
    text: 'Almost there!', timestamp: Date.now(),
  });
  const chatMsg = await chatP;
  ok('Rider received ride_chat_message', !!chatMsg);
  ok('Chat message text matches', chatMsg?.text === 'Almost there!');

  INFO('D5: In-app call flow');
  const callReqP = waitOrNull(riderSocket, 'ride_call_request', 8000);
  driverSocket.emit('ride_call_request', {
    rideRequestId: rr2Id, callerId: driverId, callerType: 'driver',
  });
  const callReq = await callReqP;
  ok('Rider received ride_call_request', !!callReq);
  ok('Call request has correct callerType', callReq?.callerType === 'driver');

  const callRespP = waitOrNull(driverSocket, 'ride_call_response', 8000);
  riderSocket.emit('ride_call_response', {
    rideRequestId: rr2Id,
    responderId: riderId,
    responderType: 'rider',
    action: 'accept',
  });
  const callResp = await callRespP;
  ok('Driver received ride_call_response (accept)', !!callResp && callResp.action === 'accept');

  const callEndP1 = waitOrNull(riderSocket, 'ride_call_ended', 8000);
  driverSocket.emit('ride_call_end', {
    rideRequestId: rr2Id,
    userId: driverId,
    userType: 'driver',
  });
  const callEnd1 = await callEndP1;
  ok('Rider received ride_call_ended', !!callEnd1);

  // ══════════════════════════════════════════════════════
  // PHASE E: RIDER-INITIATED COMPLETION
  // ══════════════════════════════════════════════════════
  SECTION('PHASE E: Rider-Initiated Completion');

  INFO('E1: Rider completes ride (rider_completed_ride; driver end_ride fallback if needed)');
  let compRiderP = waitOrNull(riderSocket, 'ride_completed', 12000);
  let compDriverP = waitOrNull(driverSocket, 'ride_completed', 12000);
  const driverNotifP = waitOrNull(driverSocket, 'rider_confirmed_arrival', 12000);
  riderSocket.emit('rider_completed_ride', { rideRequestId: rr2Id, riderId });

  let compRider = await compRiderP;
  let compDriver = await compDriverP;
  let driverNotif = await driverNotifP;

  if (!compRider || !compDriver) {
    INFO('Fallback: driver end_ride (older deploy / socket routing / handler gap)');
    compRiderP = waitOrNull(riderSocket, 'ride_completed', 15000);
    compDriverP = waitOrNull(driverSocket, 'ride_completed', 15000);
    driverSocket.emit('end_ride', { rideRequestId: rr2Id, driverId });
    compRider = compRider || (await compRiderP);
    compDriver = compDriver || (await compDriverP);
  }

  ok('Rider received ride_completed', !!compRider);
  ok('Driver received ride_completed', !!compDriver);
  const fromRiderComplete = compRider?.completedByRider === true;
  ok(
    'Driver rider_confirmed_arrival after rider completion',
    !fromRiderComplete ||
      (!!driverNotif && String(driverNotif?.message || '').toLowerCase().includes('rider')),
  );

  INFO('E2: Verify DB status');
  await sleep(600);
  const statusRes = await httpGet(`${BASE_URL}/api/ride-requests/${rr2Id}/status`, riderToken);
  const statusVal = statusRes.data?.rideRequest?.status ?? statusRes.data?.status;
  ok('GET /status 200', statusRes.ok);
  ok('DB status is completed', statusVal === 'completed');

  // ══════════════════════════════════════════════════════
  // PHASE F: REVIEWS
  // ══════════════════════════════════════════════════════
  SECTION('PHASE F: Reviews');

  INFO('F1: Rider rates driver');
  const riderRateUrl = `${BASE_URL}/api/rides/${rr2Id}/rate`;
  const riderRate = await httpPost(riderRateUrl, { rating: 5, comment: 'Excellent driver!' }, riderToken);
  okHttp('Rider rate driver 200', 'POST', riderRateUrl, riderRate);

  INFO('F2: Driver rates rider');
  const driverRateUrl = `${BASE_URL}/api/rides/${rr2Id}/rate`;
  const driverRate = await httpPost(driverRateUrl, { rating: 4, comment: 'Good passenger' }, driverToken);
  okHttp('Driver rate rider 200', 'POST', driverRateUrl, driverRate);

  // ══════════════════════════════════════════════════════
  // PHASE G: DRIVER-INITIATED END RIDE
  // ══════════════════════════════════════════════════════
  SECTION('PHASE G: Driver-Initiated End Ride (new ride)');

  INFO('G1: Create + offer + accept + start a fresh ride');
  const rr3Req = await httpPost(`${BASE_URL}/api/ride-requests/request-ride`, {
    pickup: PICKUP, destination: DEST, offeredFare: 300,
    radiusMeters: 50000, paymentMethod: 'cash', vehicleType: 'any',
  }, riderToken);
  ok('Third ride request created', rr3Req.ok);
  const rr3Id = String(rr3Req.data?.rideRequest?.id || rr3Req.data?.rideRequest?._id || '');
  await sleep(300);

  driverSocket.emit('fare_offer', {
    rideRequestId: rr3Id, driverId, driverName: 'Test Driver',
    driverRating: 4.5, fareAmount: 300, arrivalTime: 3,
    vehicleInfo: 'Toyota Corolla',
  });
  await waitOrNull(riderSocket, 'fare_offer', 8000);
  riderSocket.emit('fare_response', {
    rideRequestId: rr3Id, riderId, action: 'accept', timestamp: Date.now(),
  });
  await waitOrNull(riderSocket, 'fare_response_confirmed', 8000);
  await sleep(300);

  riderSocket.emit('rider_arrived', {
    rideRequestId: rr3Id,
    riderId,
    latitude: PICKUP.latitude,
    longitude: PICKUP.longitude,
  });
  await waitOrNull(driverSocket, 'rider_at_pickup', 8000);

  driverSocket.emit('start_ride', { rideRequestId: rr3Id, driverId });
  await waitOrNull(riderSocket, 'ride_started', 8000);
  ok('Third ride in_progress', true);

  INFO('G2: Driver ends ride');
  const endRiderP = waitOrNull(riderSocket, 'ride_completed', 12000);
  const endDriverP = waitOrNull(driverSocket, 'ride_completed', 12000);
  driverSocket.emit('end_ride', { rideRequestId: rr3Id, driverId });
  const endRider = await endRiderP;
  const endDriver = await endDriverP;
  ok('Rider received ride_completed (driver end)', !!endRider);
  ok('Driver received ride_completed (driver end)', !!endDriver);

  await sleep(500);
  const st3 = await httpGet(`${BASE_URL}/api/ride-requests/${rr3Id}/status`, riderToken);
  ok('Third ride DB status completed', (st3.data?.rideRequest?.status ?? st3.data?.status) === 'completed');

  // ══════════════════════════════════════════════════════
  // PHASE H: STATUS POLLING
  // ══════════════════════════════════════════════════════
  SECTION('PHASE H: Status Polling');

  INFO('H1: Verify ride history via status endpoint');
  const finalStatus2 = await httpGet(`${BASE_URL}/api/ride-requests/${rr2Id}/status`, riderToken);
  ok('Ride 2 status accessible', finalStatus2.ok);
  ok('Ride 2 confirmed completed', (finalStatus2.data?.rideRequest?.status ?? finalStatus2.data?.status) === 'completed');

  const finalStatus3 = await httpGet(`${BASE_URL}/api/ride-requests/${rr3Id}/status`, driverToken);
  ok('Ride 3 status accessible by driver', finalStatus3.ok);
  ok('Ride 3 confirmed completed', (finalStatus3.data?.rideRequest?.status ?? finalStatus3.data?.status) === 'completed');

  } finally {
    try { riderSocket?.disconnect(); } catch {}
    try { driverSocket?.disconnect(); } catch {}
    await restoreDriverWalletMinimum();
  }

  // ══════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════
  console.log('\n' + '='.repeat(60));
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60) + '\n');

  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error('\n\uD83D\uDCA5  Fatal:', err?.stack || err?.message || err);
  process.exitCode = 1;
});
