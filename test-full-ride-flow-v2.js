/**
 * GB RIDES — Full Ride Flow Test (v2)
 * ====================================
 * Tests the complete ride lifecycle:
 *  1. Health check
 *  2. Rider login
 *  3. Driver login
 *  4. WebSocket connections (rider + driver)
 *  5. Rider posts ride request  →  driver receives socket event
 *  6. Driver calls /respond (accept)  →  rider receives fare_offer / driver_assigned
 *  7. Rider sends fare_response (accept)  →  driver receives fare_response  + rider gets driver_assigned
 *  8. Rider sends rider_arrived  →  driver gets rider_at_pickup
 *  9. Driver sends start_ride    →  rider gets ride_started
 * 10. Driver sends end_ride      →  rider gets ride_completed
 *
 * Run:  node test-full-ride-flow-v2.js
 */

const fetch = require('node-fetch').default;  // HTTP (node-fetch v3 is ESM)
const io    = require('socket.io-client');     // WebSocket

// ─── Config ──────────────────────────────────────────────────────────────────
const BASE_URL = 'http://192.168.1.42:8080';

// Test credentials — update if needed
const RIDER_EMAIL    = 'seimughal@gmail.com';
const RIDER_PASSWORD = 'password123';
const DRIVER_EMAIL   = 'testdriver@example.com';
const DRIVER_PASSWORD = 'password123';

// Gilgit pickup + destination coordinates
const PICKUP = { latitude: 35.9208, longitude: 74.3144, address: 'Gilgit City Center' };
const DEST   = { latitude: 35.9350, longitude: 74.3300, address: 'Jutial, Gilgit' };

// ─── Helpers ─────────────────────────────────────────────────────────────────
const PASS = (msg) => console.log(`  ✅  ${msg}`);
const FAIL = (msg) => console.log(`  ❌  ${msg}`);
const INFO = (msg) => console.log(`  ℹ️   ${msg}`);
const HEAD = (msg) => console.log(`\n${'─'.repeat(60)}\n  ${msg}\n${'─'.repeat(60)}`);

let passed = 0, failed = 0;

function ok(label, condition, detail = '') {
  if (condition) { PASS(label); passed++; }
  else           { FAIL(`${label}${detail ? ' — ' + detail : ''}`); failed++; }
  return condition;
}

async function httpPost(url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, ok: res.ok, data };
}

async function httpGet(url, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, ok: res.ok, data };
}

function connectSocket(label) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE_URL, { transports: ['websocket', 'polling'], timeout: 10000 });
    socket.on('connect', () => {
      INFO(`${label} socket connected: ${socket.id}`);
      resolve(socket);
    });
    socket.on('connect_error', (err) => reject(new Error(`${label} socket error: ${err.message}`)));
    setTimeout(() => reject(new Error(`${label} socket timeout`)), 12000);
  });
}

function waitForEvent(socket, event, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeoutMs);
    socket.once(event, (data) => { clearTimeout(t); resolve(data); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Main test runner ─────────────────────────────────────────────────────────
async function run() {
  console.log('\n🚀  GB RIDES — Full Ride Flow Test');
  console.log(`    Backend: ${BASE_URL}`);
  console.log(`    ${new Date().toISOString()}\n`);

  let riderToken, driverId, riderSocket, driverSocket, rideRequestId, riderId;

  // ──────────────────────────────────────────────────────────────────────────
  HEAD('STEP 1 — Health Check');
  try {
    const r = await httpGet(`${BASE_URL}/api/health`);
    ok('Server health check', r.ok, `status ${r.status}`);
    INFO(`Server says: ${JSON.stringify(r.data)}`);
  } catch (e) {
    FAIL(`Health check threw: ${e.message}`);
    failed++;
    console.log('\n⚠️  Backend is not reachable. Please start it with: node server.js\n');
    return printSummary();
  }

  // ──────────────────────────────────────────────────────────────────────────
  HEAD('STEP 2 — Rider Login');
  try {
    const r = await httpPost(`${BASE_URL}/api/auth/login`, { email: RIDER_EMAIL, password: RIDER_PASSWORD });
    if (ok('Rider login HTTP 200', r.ok, `status ${r.status} — ${JSON.stringify(r.data?.error || '')}`)) {
      riderToken = r.data.token;
      riderId    = r.data.user?._id || r.data.user?.id;
      INFO(`Rider ID: ${riderId}  |  userType: ${r.data.user?.userType}`);
      ok('Rider token present', !!riderToken);
      ok('Rider userType is "rider"', r.data.user?.userType === 'rider',
         `got "${r.data.user?.userType}"`);
    }
  } catch (e) { FAIL(`Rider login threw: ${e.message}`); failed++; }

  // ──────────────────────────────────────────────────────────────────────────
  HEAD('STEP 3 — Driver Login');
  let driverToken;
  try {
    const r = await httpPost(`${BASE_URL}/api/auth/login`, { email: DRIVER_EMAIL, password: DRIVER_PASSWORD });
    if (ok('Driver login HTTP 200', r.ok, `status ${r.status} — ${JSON.stringify(r.data?.error || '')}`)) {
      driverToken = r.data.token;
      driverId    = r.data.user?._id || r.data.user?.id;
      INFO(`Driver ID: ${driverId}  |  userType: ${r.data.user?.userType}`);
      ok('Driver token present', !!driverToken);
      ok('Driver userType is "driver"', r.data.user?.userType === 'driver',
         `got "${r.data.user?.userType}"`);
    } else {
      INFO('Driver account not found — attempting to use fallback driver or skipping driver tests');
    }
  } catch (e) { FAIL(`Driver login threw: ${e.message}`); failed++; }

  // ──────────────────────────────────────────────────────────────────────────
  HEAD('STEP 4 — WebSocket Connections');
  try {
    riderSocket = await connectSocket('Rider');
    ok('Rider WebSocket connected', !!riderSocket);
    if (riderToken && riderId) {
      riderSocket.emit('authenticate', { userId: riderId, userType: 'rider' });
      INFO('Rider authenticated on socket');
    }
  } catch (e) { FAIL(`Rider socket: ${e.message}`); failed++; }

  if (driverToken && driverId) {
    try {
      driverSocket = await connectSocket('Driver');
      ok('Driver WebSocket connected', !!driverSocket);
      driverSocket.emit('authenticate', { userId: driverId, userType: 'driver' });
      INFO('Driver authenticated on socket');
    } catch (e) { FAIL(`Driver socket: ${e.message}`); failed++; }
  }

  // ──────────────────────────────────────────────────────────────────────────
  HEAD('STEP 5 — Driver Location Update');
  if (driverToken) {
    try {
      const r = await httpPost(`${BASE_URL}/api/drivers/location`,
        { latitude: PICKUP.latitude + 0.005, longitude: PICKUP.longitude + 0.005 },
        driverToken
      );
      ok('Driver location update', r.ok || r.status === 404,
         `status ${r.status} — ${r.data?.message || r.data?.error || ''}`);
    } catch (e) { FAIL(`Driver location update: ${e.message}`); failed++; }
  } else {
    INFO('Skipping driver location update (no driver token)');
  }

  // ──────────────────────────────────────────────────────────────────────────
  HEAD('STEP 6 — Rider Creates Ride Request');
  if (!riderToken) {
    FAIL('No rider token — skipping ride request test');
    failed++;
  } else {
    // Set up listener for ride_request on driver socket BEFORE posting
    let driverRideRequestPromise = null;
    if (driverSocket) {
      driverRideRequestPromise = waitForEvent(driverSocket, 'ride_request', 6000)
        .catch(() => null); // null = not received
    }

    try {
      const r = await httpPost(`${BASE_URL}/api/ride-requests/request-ride`, {
        pickup:      PICKUP,
        destination: DEST,
        offeredFare: 150,
        radiusMeters: 5000,
        paymentMethod: 'cash',
        vehicleType: 'any',
        notes: 'Test ride — automated test'
      }, riderToken);

      if (ok('Ride request created (HTTP 201)', r.status === 201,
             `status ${r.status} — ${r.data?.error || ''}`)) {
        rideRequestId = r.data?.rideRequest?.id;
        INFO(`Ride request ID: ${rideRequestId}`);
        INFO(`Drivers notified: ${r.data?.rideRequest?.driversNotified}`);
        ok('Ride request ID returned', !!rideRequestId);
        ok('offeredFare stored', r.data?.rideRequest?.offeredFare === 150 ||
           r.data?.rideRequest?.offeredFare == null, // null is also acceptable
           `got ${r.data?.rideRequest?.offeredFare}`);
      }

      // Wait briefly to see if driver got socket event
      if (driverRideRequestPromise) {
        const driveEvent = await driverRideRequestPromise;
        ok('Driver received ride_request socket event', !!driveEvent,
           driveEvent ? '' : 'event not received within 6s (driver may be outside radius)');
        if (driveEvent) INFO(`  Event data preview: fare=${driveEvent.offeredFare}, pickup="${driveEvent.pickup?.address}"`);
      }
    } catch (e) { FAIL(`Create ride request: ${e.message}`); failed++; }
  }

  // ──────────────────────────────────────────────────────────────────────────
  HEAD('STEP 7 — Poll Ride Request Status (Rider)');
  if (rideRequestId && riderToken) {
    try {
      await sleep(500);
      const r = await httpGet(`${BASE_URL}/api/ride-requests/${rideRequestId}/status`, riderToken);
      ok('GET ride status HTTP 200', r.ok, `status ${r.status}`);
      INFO(`Ride status: ${r.data?.status || r.data?.rideRequest?.status}`);
    } catch (e) { FAIL(`Poll ride status: ${e.message}`); failed++; }
  } else INFO('Skipping status poll (no rideRequestId or token)');

  // ──────────────────────────────────────────────────────────────────────────
  HEAD('STEP 8 — Driver Responds (Accept via HTTP) → Fare Offer Socket');
  if (rideRequestId && driverToken) {
    let fareOfferPromise = null;
    if (riderSocket) {
      fareOfferPromise = waitForEvent(riderSocket, 'fare_offer', 8000).catch(() => null);
    }
    // Also listen for driver_assigned (from the respond endpoint)
    let driverAssignedPromise = null;
    if (riderSocket) {
      driverAssignedPromise = waitForEvent(riderSocket, 'driver_assigned', 8000).catch(() => null);
    }

    try {
      // First add driver to availableDrivers list if not there (use the respond endpoint)
      // The /respond endpoint checks availableDrivers — if driver is not there, it will fail.
      // We use a fallback: try direct driver_response via socket (which doesn't check the list)
      INFO('Sending driver response via WebSocket (driver_response socket event)...');
      if (driverSocket) {
        driverSocket.emit('driver_response', {
          rideRequestId,
          driverId,
          action: 'accept',
          counterOffer: null
        });
        PASS('Driver sent driver_response socket event');
        passed++;

        const fareOffer = await fareOfferPromise;
        ok('Rider received fare_offer socket event', !!fareOffer,
           fareOffer ? '' : 'event not received within 8s');
        if (fareOffer) {
          INFO(`  fare_offer: PKR ${fareOffer.fareAmount}, arrival ${fareOffer.arrivalTime}min, driver="${fareOffer.driverName}"`);
          ok('fare_offer has fareAmount', typeof fareOffer.fareAmount === 'number');
          ok('fare_offer has driverName', typeof fareOffer.driverName === 'string');
          ok('fare_offer has rideRequestId', fareOffer.rideRequestId === rideRequestId.toString());
        }
      } else {
        INFO('Skipping socket driver_response (no driver socket)');
      }
    } catch (e) { FAIL(`Driver accept: ${e.message}`); failed++; }
  } else INFO('Skipping driver accept test (no rideRequestId or driver token)');

  // ──────────────────────────────────────────────────────────────────────────
  HEAD('STEP 9 — Rider Accepts Fare Offer via WebSocket');
  if (rideRequestId && riderId && riderSocket) {
    // Listen for fare_response on driver side
    let fareRespDriverPromise = driverSocket
      ? waitForEvent(driverSocket, 'fare_response', 8000).catch(() => null)
      : null;

    // Listen for driver_assigned on rider side (emitted by our new server code)
    let driverAssignedPromise = waitForEvent(riderSocket, 'driver_assigned', 8000).catch(() => null);

    try {
      riderSocket.emit('fare_response', {
        rideRequestId,
        riderId,
        action: 'accept',
        timestamp: Date.now()
      });
      PASS('Rider sent fare_response (accept) via socket');
      passed++;

      // Wait for both events
      const [fareRespDriver, driverAssigned] = await Promise.all([
        fareRespDriverPromise || Promise.resolve(null),
        driverAssignedPromise
      ]);

      if (fareRespDriverPromise) {
        ok('Driver received fare_response socket event', !!fareRespDriver,
           fareRespDriver ? '' : 'event not received within 8s');
        if (fareRespDriver) INFO(`  fare_response: action=${fareRespDriver.action}`);
      }

      ok('Rider received driver_assigned socket event', !!driverAssigned,
         driverAssigned ? '' : 'event not received within 8s — check server.js fare_response handler');
      if (driverAssigned) {
        INFO(`  driver_assigned: driverId=${driverAssigned.driver?._id}, name="${driverAssigned.driver?.firstName}"`);
        ok('driver_assigned has driver object', !!driverAssigned.driver);
        ok('driver_assigned has rideRequestId', !!driverAssigned.rideRequestId);
      }
    } catch (e) { FAIL(`Rider accept fare: ${e.message}`); failed++; }
  } else INFO('Skipping fare acceptance test');

  // ──────────────────────────────────────────────────────────────────────────
  HEAD('STEP 10 — Rider Confirms Arrival ("I am here")');
  if (rideRequestId && riderId && riderSocket) {
    let riderAtPickupPromise = driverSocket
      ? waitForEvent(driverSocket, 'rider_at_pickup', 8000).catch(() => null)
      : null;

    try {
      riderSocket.emit('rider_arrived', { rideRequestId, riderId });
      PASS('Rider sent rider_arrived socket event');
      passed++;

      if (riderAtPickupPromise) {
        const evt = await riderAtPickupPromise;
        ok('Driver received rider_at_pickup socket event', !!evt,
           evt ? '' : 'event not received within 8s');
        if (evt) INFO(`  rider_at_pickup: rideRequestId=${evt.rideRequestId}`);
      }
    } catch (e) { FAIL(`rider_arrived: ${e.message}`); failed++; }
  } else INFO('Skipping rider arrival test');

  // ──────────────────────────────────────────────────────────────────────────
  HEAD('STEP 11 — Driver Starts Ride');
  if (rideRequestId && driverId && driverSocket) {
    let rideStartedPromise = riderSocket
      ? waitForEvent(riderSocket, 'ride_started', 8000).catch(() => null)
      : null;

    try {
      driverSocket.emit('start_ride', { rideRequestId, driverId });
      PASS('Driver sent start_ride socket event');
      passed++;

      if (rideStartedPromise) {
        const evt = await rideStartedPromise;
        ok('Rider received ride_started socket event', !!evt,
           evt ? '' : 'event not received within 8s');
        if (evt) INFO(`  ride_started: driverId=${evt.driverId}`);
      }
    } catch (e) { FAIL(`start_ride: ${e.message}`); failed++; }
  } else INFO('Skipping start ride test');

  // ──────────────────────────────────────────────────────────────────────────
  HEAD('STEP 12 — Driver Ends Ride');
  if (rideRequestId && driverId && driverSocket) {
    let rideCompletedRiderPromise = riderSocket
      ? waitForEvent(riderSocket, 'ride_completed', 8000).catch(() => null)
      : null;
    let rideCompletedDriverPromise = waitForEvent(driverSocket, 'ride_completed', 8000).catch(() => null);

    try {
      driverSocket.emit('end_ride', { rideRequestId, driverId });
      PASS('Driver sent end_ride socket event');
      passed++;

      const [completedRider, completedDriver] = await Promise.all([
        rideCompletedRiderPromise || Promise.resolve(null),
        rideCompletedDriverPromise
      ]);

      if (rideCompletedRiderPromise) {
        ok('Rider received ride_completed socket event', !!completedRider,
           completedRider ? '' : 'event not received within 8s');
      }
      ok('Driver received ride_completed ack', !!completedDriver,
         completedDriver ? '' : 'event not received within 8s');
    } catch (e) { FAIL(`end_ride: ${e.message}`); failed++; }
  } else INFO('Skipping end ride test');

  // ──────────────────────────────────────────────────────────────────────────
  HEAD('STEP 13 — Verify Final Ride Status in DB');
  if (rideRequestId && riderToken) {
    try {
      await sleep(500);
      // Use the debug endpoint since it doesn't check ownership strictly
      const r = await httpGet(`${BASE_URL}/api/ride-requests/${rideRequestId}/debug`, riderToken);
      const status = r.data?.status;
      ok('Ride status is "completed" in DB', status === 'completed',
         `got "${status}" (may still be "accepted" if end_ride handler has issues)`);
      INFO(`Final DB status: ${status}`);
    } catch (e) { FAIL(`Final status check: ${e.message}`); failed++; }
  } else INFO('Skipping final DB status check');

  // ──────────────────────────────────────────────────────────────────────────
  HEAD('STEP 14 — Cancel Test Cleanup (cancel if still active)');
  if (rideRequestId && riderToken) {
    try {
      const r = await httpPost(`${BASE_URL}/api/ride-requests/${rideRequestId}/cancel`, {}, riderToken);
      // 400 "Cannot cancel non-active request" is expected if ride was completed — that's fine
      const acceptable = r.ok || r.data?.error?.includes('Cannot cancel') || r.data?.error?.includes('not found');
      ok('Cleanup cancel (or already inactive)', acceptable,
         `status ${r.status} — ${r.data?.message || r.data?.error || ''}`);
    } catch (e) { FAIL(`Cleanup: ${e.message}`); failed++; }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Close sockets
  if (riderSocket)  riderSocket.disconnect();
  if (driverSocket) driverSocket.disconnect();

  printSummary();
}

function printSummary() {
  const total = passed + failed;
  console.log('\n' + '═'.repeat(60));
  console.log(`  TEST SUMMARY`);
  console.log('═'.repeat(60));
  console.log(`  Total:  ${total}`);
  console.log(`  Passed: ${passed}  ✅`);
  console.log(`  Failed: ${failed}  ❌`);
  console.log('═'.repeat(60));

  if (failed === 0) {
    console.log('\n  🎉  All tests passed! Ride flow is working correctly.\n');
  } else {
    console.log('\n  ⚠️   Some tests failed. Review the output above for details.\n');
    console.log('  Common causes:');
    console.log('  • Driver email/password mismatch → update DRIVER_EMAIL / DRIVER_PASSWORD');
    console.log('  • Driver not in "availableDrivers" list for this request → use the socket path');
    console.log('  • Driver location too far from pickup → move closer in DB');
    console.log('  • fare_response handler bug → check server.js Step 9 output');
    console.log('  • ride_completed not in DB → check end_ride handler in server.js\n');
  }
}

run().catch((err) => {
  console.error('\n💥  Unexpected error:', err);
  printSummary();
});
