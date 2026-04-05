/**
 * GB RIDES — E2E: cancel → driver removal, fare update, rider arrival completion
 *
 * Tests:
 *   1. Rider cancel → driver receives ride_request_cancelled (request disappears)
 *   2. Driver tries to accept cancelled request → 400 "no longer available"
 *   3. Rider fare change → driver receives ride_request_updated + fresh ride_request
 *   4. Rider arrival completion (rider_completed_ride) → both get ride_completed,
 *      driver gets rider_confirmed_arrival
 *
 * Usage:
 *   cd Backend_GR
 *   node test-offline-cancel-fare-arrival.js
 */

const fetch = require('node-fetch').default;
const io = require('socket.io-client');

const LOCAL_PORT = process.env.LOCAL_API_PORT || '8080';
const BASE_URL = (process.env.API_URL || `http://127.0.0.1:${LOCAL_PORT}`).replace(/\/$/, '');
const PASSWORD = 'password123';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PASS = (msg) => console.log(`  ✅  ${msg}`);
const FAIL = (msg) => console.log(`  ❌  ${msg}`);
const INFO = (msg) => console.log(`  ℹ️   ${msg}`);

let passed = 0;
let failed = 0;

function ok(label, condition, detail = '') {
  if (condition) { PASS(label); passed++; }
  else { FAIL(`${label}${detail ? ' — ' + detail : ''}`); failed++; }
  return condition;
}

async function httpPost(url, body, token) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
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

async function httpGet(url, token) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  let data; try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, ok: res.ok, data };
}

function connectSocket(label) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE_URL, { transports: ['websocket'], timeout: 20000 });
    socket.on('connect', () => { INFO(`${label} socket: ${socket.id}`); resolve(socket); });
    socket.on('connect_error', (err) => reject(new Error(`${label} socket err: ${err.message}`)));
    setTimeout(() => reject(new Error(`${label} socket timeout`)), 20000);
  });
}

function waitForEvent(socket, event, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout for "${event}"`)), timeoutMs);
    socket.once(event, (data) => { clearTimeout(t); resolve(data); });
  });
}

function waitOrNull(socket, event, timeoutMs = 10000) {
  return waitForEvent(socket, event, timeoutMs).catch(() => null);
}

async function registerUser({ email, phone, userType, firstName, lastName, vehiclePlateNumber }) {
  const payload = {
    email, password: PASSWORD, firstName, lastName, phone, userType,
    ...(userType === 'driver' ? {
      driverInfo: {
        vehicleInfo: { make: 'TestMake', model: 'TestModel', year: 2020, color: 'White', plateNumber: vehiclePlateNumber, vehicleType: 'car' },
        licenseNumber: `LIC-${vehiclePlateNumber}`,
        licenseExpiry: new Date(Date.now() + 365e3 * 86400).toISOString(),
        insuranceNumber: `INS-${vehiclePlateNumber}`,
        insuranceExpiry: new Date(Date.now() + 365e3 * 86400).toISOString(),
      },
    } : {}),
  };
  const r = await httpPost(`${BASE_URL}/api/auth/register`, payload);
  if (!r.ok) throw new Error(`register ${userType} failed: ${JSON.stringify(r.data?.error || r.data)}`);
  return r.data;
}

async function loginUser({ email, expectedUserType }) {
  const r = await httpPost(`${BASE_URL}/api/auth/login`, { email, password: PASSWORD, expectedUserType });
  if (!r.ok) throw new Error(`login failed: ${JSON.stringify(r.data?.error || r.data)}`);
  return { token: r.data.token, user: r.data.user };
}

async function run() {
  console.log('\n🚀 GB RIDES — cancel / fare-update / rider-arrival E2E');
  console.log(`   Backend: ${BASE_URL}\n`);

  const ts = Date.now();
  const PICKUP = { latitude: 35.9208, longitude: 74.3144, address: 'Gilgit City Center' };
  const DEST = { latitude: 35.935, longitude: 74.33, address: 'Jutial, Gilgit' };

  await registerUser({ email: `r${ts}@test.com`, phone: `9${String(ts).slice(-9)}`, userType: 'rider', firstName: 'Test', lastName: 'Rider' });
  await registerUser({ email: `d${ts}@test.com`, phone: `8${String(ts).slice(-9)}`, userType: 'driver', firstName: 'Test', lastName: 'Driver', vehiclePlateNumber: `PL-${ts}` });

  const riderLogin = await loginUser({ email: `r${ts}@test.com`, expectedUserType: 'rider' });
  const driverLogin = await loginUser({ email: `d${ts}@test.com`, expectedUserType: 'driver' });
  const riderToken = riderLogin.token;
  const riderId = String(riderLogin.user._id || riderLogin.user.id);
  const driverToken = driverLogin.token;
  const driverId = String(driverLogin.user._id || driverLogin.user.id);
  ok('Tokens obtained', !!(riderToken && driverToken));

  const riderSocket = await connectSocket('Rider');
  riderSocket.emit('authenticate', { userId: riderId, userType: 'rider' });
  const driverSocket = await connectSocket('Driver');
  driverSocket.emit('authenticate', { userId: driverId, userType: 'driver' });
  [riderSocket, driverSocket].forEach((s) => s.on('error', (m) => INFO(`socket err: ${JSON.stringify(m)}`)));
  await sleep(400);

  await httpPost(`${BASE_URL}/api/drivers/location`, { latitude: PICKUP.latitude + 0.001, longitude: PICKUP.longitude + 0.001 }, driverToken);

  // ═══════════════════════════════════════════════════════════
  // TEST 1: Rider cancel → driver gets ride_request_cancelled
  // ═══════════════════════════════════════════════════════════
  INFO('TEST 1: Rider cancel removes request from driver');
  const rr1 = await httpPost(`${BASE_URL}/api/ride-requests/request-ride`, {
    pickup: PICKUP, destination: DEST, offeredFare: 200, radiusMeters: 5000,
  }, riderToken);
  ok('ride request created', rr1.ok);
  const rr1Id = String(rr1.data?.rideRequest?.id || '');

  await sleep(500);
  const cancelledP = waitOrNull(driverSocket, 'ride_request_cancelled', 8000);
  const cancelRes = await httpPost(`${BASE_URL}/api/ride-requests/${rr1Id}/cancel`, {}, riderToken);
  ok('cancel 200', cancelRes.ok);
  const cancelledEvt = await cancelledP;
  ok('Driver got ride_request_cancelled', !!cancelledEvt && String(cancelledEvt.rideRequestId) === rr1Id);

  // TEST 2: Driver tries to accept the cancelled request
  INFO('TEST 2: Driver accepts cancelled request → "no longer available"');
  const acceptRes = await httpPost(`${BASE_URL}/api/ride-requests/${rr1Id}/respond`, { action: 'accept' }, driverToken);
  ok('Accept returns 400', acceptRes.status === 400);
  ok('Error says "no longer available"', String(acceptRes.data?.error || '').includes('no longer available'));

  // ═══════════════════════════════════════════════════════════
  // TEST 3: Fare change → driver gets updated ride_request
  // ═══════════════════════════════════════════════════════════
  INFO('TEST 3: Fare update re-pushes request to driver');
  const rr2 = await httpPost(`${BASE_URL}/api/ride-requests/request-ride`, {
    pickup: PICKUP, destination: DEST, offeredFare: 100, radiusMeters: 5000,
  }, riderToken);
  ok('second request created', rr2.ok);
  const rr2Id = String(rr2.data?.rideRequest?.id || '');
  await sleep(400);

  const updatedP = waitOrNull(driverSocket, 'ride_request_updated', 8000);
  const freshRideP = waitOrNull(driverSocket, 'ride_request', 8000);
  const fareRes = await httpPatch(`${BASE_URL}/api/ride-requests/${rr2Id}/fare`, { offeredFare: 180 }, riderToken);
  ok('PATCH fare 200', fareRes.ok);

  const updatedEvt = await updatedP;
  ok('Driver got ride_request_updated with new fare', !!updatedEvt && updatedEvt.requestedPrice === 180);
  ok('ride_request_updated includes oldFare', !!updatedEvt && updatedEvt.oldFare === 100);

  const freshEvt = await freshRideP;
  ok('Driver got fresh ride_request with new fare', !!freshEvt && freshEvt.offeredFare === 180);

  // Clean up rr2
  await httpPost(`${BASE_URL}/api/ride-requests/${rr2Id}/cancel`, {}, riderToken);

  // ═══════════════════════════════════════════════════════════
  // TEST 4: rider_completed_ride flow
  // ═══════════════════════════════════════════════════════════
  INFO('TEST 4: Rider arrival completion');
  const rr3 = await httpPost(`${BASE_URL}/api/ride-requests/request-ride`, {
    pickup: PICKUP, destination: DEST, offeredFare: 150, radiusMeters: 5000,
  }, riderToken);
  ok('third request created', rr3.ok);
  const rr3Id = String(rr3.data?.rideRequest?.id || '');
  await sleep(400);

  // Driver sends fare offer + rider accepts
  driverSocket.emit('fare_offer', {
    rideRequestId: rr3Id, driverId, driverName: 'Test Driver', driverRating: 4.5,
    fareAmount: 150, arrivalTime: 5, vehicleInfo: 'Car',
  });
  await waitOrNull(riderSocket, 'fare_offer', 8000);
  riderSocket.emit('fare_response', { rideRequestId: rr3Id, riderId, action: 'accept', timestamp: Date.now() });
  await waitOrNull(riderSocket, 'fare_response_confirmed', 8000);
  await sleep(300);

  // rider_arrived + start_ride
  riderSocket.emit('rider_arrived', { rideRequestId: rr3Id, riderId });
  await waitOrNull(driverSocket, 'rider_at_pickup', 8000);
  driverSocket.emit('start_ride', { rideRequestId: rr3Id, driverId });
  await waitOrNull(riderSocket, 'ride_started', 8000);
  await sleep(300);

  // Rider completes via rider_completed_ride
  const compRiderP = waitOrNull(riderSocket, 'ride_completed', 10000);
  const compDriverP = waitOrNull(driverSocket, 'ride_completed', 10000);
  const driverNotifP = waitOrNull(driverSocket, 'rider_confirmed_arrival', 10000);
  riderSocket.emit('rider_completed_ride', { rideRequestId: rr3Id, riderId });
  const compRider = await compRiderP;
  const compDriver = await compDriverP;
  const driverNotif = await driverNotifP;
  ok('Rider got ride_completed', !!compRider);
  ok('ride_completed has completedByRider flag', !!compRider?.completedByRider);
  ok('Driver got ride_completed', !!compDriver);
  ok('Driver got rider_confirmed_arrival', !!driverNotif);
  ok('rider_confirmed_arrival message', String(driverNotif?.message || '').includes('rider has marked'));

  await sleep(500);
  const statusRes = await httpGet(`${BASE_URL}/api/ride-requests/${rr3Id}/status`, riderToken);
  ok('DB status is completed', statusRes.ok && (statusRes.data?.rideRequest?.status || statusRes.data?.status) === 'completed');

  // Cleanup
  try { riderSocket.disconnect(); driverSocket.disconnect(); } catch {}

  console.log('\n' + '═'.repeat(60));
  console.log(`  Passed: ${passed}   Failed: ${failed}`);
  console.log('═'.repeat(60) + '\n');
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error('\n💥', err?.stack || err?.message || err);
  process.exitCode = 1;
});
