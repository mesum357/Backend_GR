#!/usr/bin/env node
/**
 * GB RIDES — Ride cancellation E2E
 * ==================================
 * Exercises the full API + Socket.IO paths for cancellation:
 *
 *   A) Rider cancels while searching (before accept) → DB cancelled, driver gets realtime events
 *   B) Rider cancels after fare accept → driver receives ride_cancelled, status cancelled
 *   C) Driver cancels after ride_started (in_progress) → rider receives ride_cancelled, status cancelled
 *
 * Usage (local — default http://127.0.0.1:8080):
 *   1. Start MongoDB, then: npm run dev   (or node server.js)
 *   2. npm run e2e:ride-cancel
 *      (wrapper sets LOCAL_ONLY=1 so a global API_URL in your shell does not override localhost)
 *
 * Remote (must include the same backend version — cancel route allows accepted/in_progress):
 *   API_URL=https://your-app.onrender.com npm run e2e:ride-cancel:remote
 *
 * Optional port: LOCAL_API_PORT=3000 npm run e2e:ride-cancel
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
const PASSWORD = 'password123';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PASS = (msg) => console.log(`  ✅  ${msg}`);
const FAIL = (msg) => console.log(`  ❌  ${msg}`);
const INFO = (msg) => console.log(`  ℹ️   ${msg}`);
const HEAD = (msg) => console.log(`\n${'─'.repeat(60)}\n  ${msg}\n${'─'.repeat(60)}`);

let passed = 0;
let failed = 0;

function ok(label, condition, detail = '') {
  if (condition) {
    PASS(label);
    passed++;
  } else {
    FAIL(`${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
  return condition;
}

function okHttp(label, method, url, res) {
  if (res.ok) {
    PASS(label);
    passed++;
    return true;
  }
  FAIL(`${label} — ${res.status}`);
  INFO(`  debug: ${method} ${url}`);
  try {
    INFO(`    body: ${JSON.stringify(res.data, null, 2)}`);
  } catch {
    INFO('    body: (unserializable)');
  }
  failed++;
  return false;
}

async function httpPost(url, body, token) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
  let data;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { status: res.status, ok: res.ok, data };
}

async function httpGet(url, token) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  let data;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { status: res.status, ok: res.ok, data };
}

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

function waitForEvent(socket, event, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeoutMs);
    socket.once(event, (data) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

function createTestEmails() {
  const ts = Date.now();
  return {
    riderEmail: `cancelRider${ts}@example.com`,
    riderPhone: `7${String(ts).slice(-9)}`,
    driverEmail: `cancelDriver${ts}@example.com`,
    driverPhone: `6${String(ts).slice(-9)}`,
  };
}

async function registerUser({ email, phone, userType, firstName, lastName, vehiclePlateNumber, vehicleType }) {
  const driverInfo =
    userType === 'driver'
      ? {
          vehicleInfo: {
            make: 'TestMake',
            model: 'TestModel',
            year: 2015,
            color: 'White',
            plateNumber: vehiclePlateNumber,
            vehicleType: vehicleType || 'car',
          },
          licenseNumber: `LIC-${vehiclePlateNumber}`,
          licenseExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          insuranceNumber: `INS-${vehiclePlateNumber}`,
          insuranceExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        }
      : undefined;

  const payload = {
    email,
    password: PASSWORD,
    firstName,
    lastName,
    phone,
    userType,
    ...(driverInfo ? { driverInfo } : {}),
  };

  const r = await httpPost(`${BASE_URL}/api/auth/register`, payload);
  if (!r.ok) throw new Error(`register ${userType} failed: ${r.status} ${JSON.stringify(r.data?.error || r.data)}`);
  return r.data;
}

async function loginUser({ email, expectedUserType }) {
  const r = await httpPost(`${BASE_URL}/api/auth/login`, { email, password: PASSWORD, expectedUserType });
  if (!r.ok) throw new Error(`login ${expectedUserType} failed: ${r.status} ${JSON.stringify(r.data?.error || r.data)}`);
  return { token: r.data.token, user: r.data.user };
}

async function getRideStatus(token, rideRequestId) {
  const st = await httpGet(`${BASE_URL}/api/ride-requests/${rideRequestId}/status`, token);
  return st.data?.rideRequest?.status ?? st.data?.status ?? null;
}

/**
 * request-ride → optional fare accept → returns rideRequestId
 */
async function createRideAndOptionallyAccept(riderToken, driverToken, driverId, riderId, riderSocket, driverSocket, accept) {
  const PICKUP = { latitude: 35.9208, longitude: 74.3144, address: 'Gilgit City Center' };
  const DEST = { latitude: 35.935, longitude: 74.33, address: 'Jutial, Gilgit' };

  await httpPost(
    `${BASE_URL}/api/drivers/location`,
    { latitude: PICKUP.latitude + 0.001, longitude: PICKUP.longitude + 0.001 },
    driverToken
  );

  const rideReq = await httpPost(
    `${BASE_URL}/api/ride-requests/request-ride`,
    {
      pickup: PICKUP,
      destination: DEST,
      offeredFare: 150,
      radiusMeters: 5000,
      paymentMethod: 'cash',
      vehicleType: 'any',
      notes: 'E2E cancel flow',
    },
    riderToken
  );
  if (!rideReq.ok) throw new Error(`request-ride failed: ${JSON.stringify(rideReq.data)}`);
  const rideRequestId = String(rideReq.data?.rideRequest?.id || rideReq.data?.rideRequest?._id || '');
  if (!rideRequestId) throw new Error('missing rideRequestId');

  if (!accept) return { rideRequestId };

  const fareOfferPayload = {
    rideRequestId,
    driverId,
    driverName: 'E2E Driver',
    driverRating: 4.5,
    fareAmount: 150,
    arrivalTime: 5,
    vehicleInfo: 'Standard Vehicle',
  };
  const fareOfferPromise = waitForEvent(riderSocket, 'fare_offer', 12000).catch(() => null);
  driverSocket.emit('fare_offer', fareOfferPayload);
  await fareOfferPromise;

  const confP = waitForEvent(riderSocket, 'fare_response_confirmed', 12000).catch(() => null);
  const assP = waitForEvent(riderSocket, 'driver_assigned', 12000).catch(() => null);
  riderSocket.emit('fare_response', { rideRequestId, riderId, action: 'accept', timestamp: Date.now() });
  await Promise.all([confP, assP]);

  return { rideRequestId };
}

async function run() {
  console.log('\n🚀  GB RIDES — Ride cancellation E2E');
  console.log(`    Backend: ${BASE_URL}`);
  if (USE_LOCAL_ONLY) {
    console.log('    Mode: local only (use API_URL + npm run e2e:ride-cancel:remote for deployed API)');
  }
  console.log(`    ${new Date().toISOString()}\n`);

  const { riderEmail, riderPhone, driverEmail, driverPhone } = createTestEmails();
  const plate = `PLATE-${Date.now()}`;
  const PICKUP = { latitude: 35.9208, longitude: 74.3144, address: 'Gilgit City Center' };
  const DEST = { latitude: 35.935, longitude: 74.33, address: 'Jutial, Gilgit' };

  HEAD('Health');
  try {
    const h = await httpGet(`${BASE_URL}/api/health`);
    ok('GET /api/health', h.ok, `status ${h.status}`);
  } catch (e) {
    FAIL(`Health check failed: ${e.message}`);
    failed++;
    console.log('\n⚠️  Start the backend (e.g. npm run dev) and ensure MongoDB is running.\n');
    printSummary();
    process.exitCode = 1;
    return;
  }

  HEAD('Register + login + sockets');
  await registerUser({
    email: riderEmail,
    phone: riderPhone,
    userType: 'rider',
    firstName: 'Cancel',
    lastName: 'Rider',
  });
  await registerUser({
    email: driverEmail,
    phone: driverPhone,
    userType: 'driver',
    firstName: 'Cancel',
    lastName: 'Driver',
    vehiclePlateNumber: plate,
    vehicleType: 'car',
  });

  const riderLogin = await loginUser({ email: riderEmail, expectedUserType: 'rider' });
  const driverLogin = await loginUser({ email: driverEmail, expectedUserType: 'driver' });
  const riderToken = riderLogin.token;
  const riderId = String(riderLogin.user._id || riderLogin.user.id);
  const driverToken = driverLogin.token;
  const driverId = String(driverLogin.user._id || driverLogin.user.id);
  ok('Tokens', !!(riderToken && driverToken));

  const riderSocket = await connectSocket('Rider');
  riderSocket.emit('authenticate', { userId: riderId, userType: 'rider' });
  const driverSocket = await connectSocket('Driver');
  driverSocket.emit('authenticate', { userId: driverId, userType: 'driver' });
  riderSocket.on('error', (msg) => INFO(`Rider socket error: ${JSON.stringify(msg)}`));
  driverSocket.on('error', (msg) => INFO(`Driver socket error: ${JSON.stringify(msg)}`));
  await sleep(400);

  // ─── Scenario A: rider cancels while searching ─────────────────────────────
  HEAD('Scenario A — Rider cancels before accept (searching)');
  let rideRequestId;
  try {
    await httpPost(
      `${BASE_URL}/api/drivers/location`,
      { latitude: PICKUP.latitude + 0.001, longitude: PICKUP.longitude + 0.001 },
      driverToken
    );
    const rideReq = await httpPost(
      `${BASE_URL}/api/ride-requests/request-ride`,
      {
        pickup: PICKUP,
        destination: DEST,
        offeredFare: 150,
        radiusMeters: 5000,
        paymentMethod: 'cash',
        vehicleType: 'any',
        notes: 'Cancel A',
      },
      riderToken
    );
    ok('request-ride 200', rideReq.ok, JSON.stringify(rideReq.data?.error || ''));
    rideRequestId = String(rideReq.data?.rideRequest?.id || rideReq.data?.rideRequest?._id || '');
    ok('rideRequestId present', !!rideRequestId);

    // Ensure this driver is on the request so cancellation fan-out includes them (availableDrivers).
    driverSocket.emit('ride_request_viewed', { rideRequestId, driverId });
    await sleep(500);

    const driverCancelP = waitForEvent(driverSocket, 'ride_cancelled', 12000);
    const cancelRes = await httpPost(`${BASE_URL}/api/ride-requests/${rideRequestId}/cancel`, {}, riderToken);
    okHttp('Rider POST /cancel 200', 'POST', `${BASE_URL}/api/ride-requests/${rideRequestId}/cancel`, cancelRes);

    const driverEvt = await driverCancelP;
    ok(
      'Driver received ride_cancelled with matching id',
      String(driverEvt?.rideRequestId) === rideRequestId,
      JSON.stringify(driverEvt)
    );

    const stA = await getRideStatus(riderToken, rideRequestId);
    ok('Ride status in DB is cancelled', stA === 'cancelled', String(stA));
  } catch (e) {
    FAIL(`Scenario A threw: ${e.message}`);
    failed++;
  }

  // ─── Scenario B: rider cancels after accept ───────────────────────────────
  HEAD('Scenario B — Rider cancels after fare accept');
  try {
    const { rideRequestId: rid } = await createRideAndOptionallyAccept(
      riderToken,
      driverToken,
      driverId,
      riderId,
      riderSocket,
      driverSocket,
      true
    );

    let riderSpurious = false;
    riderSocket.once('ride_cancelled', () => {
      riderSpurious = true;
    });

    const driverCancelP = waitForEvent(driverSocket, 'ride_cancelled', 12000);
    const cancelRes = await httpPost(`${BASE_URL}/api/ride-requests/${rid}/cancel`, {}, riderToken);
    okHttp('Rider POST /cancel after accept 200', 'POST', `${BASE_URL}/api/ride-requests/${rid}/cancel`, cancelRes);

    const driverEvt = await driverCancelP;
    ok(
      'Driver received ride_cancelled',
      String(driverEvt?.rideRequestId) === rid,
      JSON.stringify(driverEvt)
    );

    await sleep(300);
    ok('Rider did not receive ride_cancelled (self-cancel not echoed)', !riderSpurious);

    const stB = await getRideStatus(riderToken, rid);
    ok('Ride status is cancelled', stB === 'cancelled', String(stB));
  } catch (e) {
    FAIL(`Scenario B threw: ${e.message}`);
    failed++;
  }

  // ─── Scenario C: driver cancels after start_ride (in_progress) ───────────
  HEAD('Scenario C — Driver cancels after ride started');
  try {
    const { rideRequestId: rid } = await createRideAndOptionallyAccept(
      riderToken,
      driverToken,
      driverId,
      riderId,
      riderSocket,
      driverSocket,
      true
    );

    const riderAtP = waitForEvent(driverSocket, 'rider_at_pickup', 12000).catch(() => null);
    riderSocket.emit('rider_arrived', { rideRequestId: rid, riderId });
    await riderAtP;

    const startedP = waitForEvent(riderSocket, 'ride_started', 12000).catch(() => null);
    driverSocket.emit('start_ride', { rideRequestId: rid, driverId });
    await startedP;

    const stMid = await getRideStatus(riderToken, rid);
    ok('Status is in_progress or accepted after start', stMid === 'in_progress' || stMid === 'accepted', String(stMid));

    let driverEchoForThisRide = false;
    const driverEchoHandler = (data) => {
      if (String(data?.rideRequestId) === rid) driverEchoForThisRide = true;
    };
    driverSocket.on('ride_cancelled', driverEchoHandler);

    const riderCancelP = waitForEvent(riderSocket, 'ride_cancelled', 12000);
    const cancelRes = await httpPost(`${BASE_URL}/api/ride-requests/${rid}/cancel`, {}, driverToken);
    okHttp('Driver POST /cancel 200', 'POST', `${BASE_URL}/api/ride-requests/${rid}/cancel`, cancelRes);

    const riderEvt = await riderCancelP;
    ok(
      'Rider received ride_cancelled',
      String(riderEvt?.rideRequestId) === rid,
      JSON.stringify(riderEvt)
    );

    await sleep(500);
    driverSocket.off('ride_cancelled', driverEchoHandler);
    ok('Driver did not receive self-echo ride_cancelled', !driverEchoForThisRide);

    const stC = await getRideStatus(riderToken, rid);
    ok('Ride status is cancelled', stC === 'cancelled', String(stC));
  } catch (e) {
    FAIL(`Scenario C threw: ${e.message}`);
    failed++;
  }

  // ─── Scenario D: socket ride_cancelled when already cancelled (idempotent) ─
  HEAD('Scenario D — Socket cancel after HTTP cancel (alreadyEnded ack)');
  try {
    const { rideRequestId: rid } = await createRideAndOptionallyAccept(
      riderToken,
      driverToken,
      driverId,
      riderId,
      riderSocket,
      driverSocket,
      true
    );

    await httpPost(`${BASE_URL}/api/ride-requests/${rid}/cancel`, {}, riderToken);
    const st1 = await getRideStatus(riderToken, rid);
    ok('HTTP cancel → status cancelled', st1 === 'cancelled');

    const dup = await new Promise((resolve) => {
      riderSocket.once('ride_cancelled_ack', resolve);
      riderSocket.emit('ride_cancelled', {
        rideRequestId: rid,
        userId: riderId,
        userType: 'rider',
        timestamp: Date.now(),
      });
      setTimeout(() => resolve({ timeout: true }), 5000);
    });
    ok(
      'Second cancel via socket returns alreadyEnded',
      dup && !dup.timeout && dup.alreadyEnded === true,
      JSON.stringify(dup)
    );
  } catch (e) {
    FAIL(`Scenario D threw: ${e.message}`);
    failed++;
  }

  try {
    riderSocket.disconnect();
    driverSocket.disconnect();
  } catch {}

  printSummary();
  if (failed > 0) process.exitCode = 1;
}

function printSummary() {
  console.log('\n' + '═'.repeat(60));
  console.log(`  Passed: ${passed}   Failed: ${failed}`);
  console.log('═'.repeat(60) + '\n');
}

run().catch((err) => {
  console.error('\n💥', err?.stack || err?.message || err);
  process.exitCode = 1;
});
