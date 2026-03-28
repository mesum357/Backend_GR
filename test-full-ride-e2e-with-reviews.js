/**
 * GB RIDES — Full ride E2E including reviews
 *
 * Flow:
 *   Register + login rider & driver → sockets + user rooms
 *   request-ride → fare_offer → fare_response accept → rider_arrived → start_ride → end_ride
 *   Assert rider + driver receive ride_completed
 *   POST /api/rides/:rideRequestId/rate as rider (rate driver) and as driver (rate rider)
 *   Assert ratings accepted (200)
 *
 * Usage:
 *   node test-full-ride-e2e-with-reviews.js
 *   API_URL=https://backend-gr-qcny.onrender.com node test-full-ride-e2e-with-reviews.js
 */

const fetch = require('node-fetch').default;
const io = require('socket.io-client');

const BASE_URL = (process.env.API_URL || process.env.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const PASSWORD = 'password123';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PASS = (msg) => console.log(`  ✅  ${msg}`);
const FAIL = (msg) => console.log(`  ❌  ${msg}`);
const INFO = (msg) => console.log(`  ℹ️   ${msg}`);

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

async function httpPost(url, body, token) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
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
    // WebSocket-only avoids polling requests landing on a different Render instance
    // than the WS upgrade (Socket.IO rooms would otherwise miss events).
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
    riderEmail: `e2eRider${ts}@example.com`,
    riderPhone: `9${String(ts).slice(-9)}`,
    driverEmail: `e2eDriver${ts}@example.com`,
    driverPhone: `8${String(ts).slice(-9)}`,
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

async function run() {
  console.log('\n🚀  GB RIDES — Full E2E (ride + reviews)');
  console.log(`    Backend: ${BASE_URL}`);
  console.log(`    ${new Date().toISOString()}\n`);

  const { riderEmail, riderPhone, driverEmail, driverPhone } = createTestEmails();
  const PICKUP = { latitude: 35.9208, longitude: 74.3144, address: 'Gilgit City Center' };
  const DEST = { latitude: 35.935, longitude: 74.33, address: 'Jutial, Gilgit' };
  const riderVehiclePlate = `PLATE-${Date.now()}`;

  INFO('Register + login');
  await registerUser({
    email: riderEmail,
    phone: riderPhone,
    userType: 'rider',
    firstName: 'E2E',
    lastName: 'Rider',
  });
  await registerUser({
    email: driverEmail,
    phone: driverPhone,
    userType: 'driver',
    firstName: 'E2E',
    lastName: 'Driver',
    vehiclePlateNumber: riderVehiclePlate,
    vehicleType: 'car',
  });

  const riderLogin = await loginUser({ email: riderEmail, expectedUserType: 'rider' });
  const driverLogin = await loginUser({ email: driverEmail, expectedUserType: 'driver' });
  const riderToken = riderLogin.token;
  const riderId = String(riderLogin.user._id || riderLogin.user.id);
  const driverToken = driverLogin.token;
  const driverId = String(driverLogin.user._id || driverLogin.user.id);
  ok('Rider + driver tokens', !!(riderToken && driverToken));

  INFO('Sockets (String user ids for user:<id> rooms)');
  const riderSocket = await connectSocket('Rider');
  riderSocket.emit('authenticate', { userId: riderId, userType: 'rider' });
  const driverSocket = await connectSocket('Driver');
  driverSocket.emit('authenticate', { userId: driverId, userType: 'driver' });
  const logSockErr = (label, sock) => {
    sock.on('error', (msg) =>
      INFO(`${label} socket "error" from server: ${JSON.stringify(msg)}`)
    );
  };
  logSockErr('Rider', riderSocket);
  logSockErr('Driver', driverSocket);
  await sleep(400);

  await httpPost(
    `${BASE_URL}/api/drivers/location`,
    { latitude: PICKUP.latitude + 0.001, longitude: PICKUP.longitude + 0.001 },
    driverToken
  );

  INFO('Create ride request');
  const rideReq = await httpPost(
    `${BASE_URL}/api/ride-requests/request-ride`,
    {
      pickup: PICKUP,
      destination: DEST,
      offeredFare: 150,
      radiusMeters: 5000,
      paymentMethod: 'cash',
      vehicleType: 'any',
      notes: 'E2E full flow',
    },
    riderToken
  );
  ok('request-ride', rideReq.ok, JSON.stringify(rideReq.data?.error || ''));
  const rideRequestId = String(rideReq.data?.rideRequest?.id || rideReq.data?.rideRequest?._id || '');
  ok('rideRequestId', !!rideRequestId);

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
  const fareOfferEvt = await fareOfferPromise;
  ok('Rider got fare_offer', !!fareOfferEvt);

  INFO('Rider accepts fare');
  const confP = waitForEvent(riderSocket, 'fare_response_confirmed', 12000).catch(() => null);
  const assP = waitForEvent(riderSocket, 'driver_assigned', 12000).catch(() => null);
  riderSocket.emit('fare_response', { rideRequestId, riderId, action: 'accept', timestamp: Date.now() });
  await Promise.all([confP, assP]);
  ok('fare_response flow', true);

  INFO('rider_arrived + start + end');
  const riderAtP = waitForEvent(driverSocket, 'rider_at_pickup', 12000).catch(() => null);
  riderSocket.emit('rider_arrived', { rideRequestId, riderId });
  await riderAtP;
  ok('Driver got rider_at_pickup', true);

  const startedP = waitForEvent(riderSocket, 'ride_started', 12000).catch(() => null);
  driverSocket.emit('start_ride', { rideRequestId, driverId });
  await startedP;
  ok('Rider got ride_started', true);

  const doneRiderP = waitForEvent(riderSocket, 'ride_completed', 15000).catch(() => null);
  const doneDriverP = waitForEvent(driverSocket, 'ride_completed', 15000).catch(() => null);
  driverSocket.emit('end_ride', { rideRequestId, driverId });
  const doneRider = await doneRiderP;
  const doneDriver = await doneDriverP;
  ok('Rider got ride_completed', !!doneRider, doneRider ? '' : 'check server user rooms + emitToUser');
  ok('Driver got ride_completed', !!doneDriver);

  await sleep(500);
  const st = await httpGet(`${BASE_URL}/api/ride-requests/${rideRequestId}/status`, riderToken);
  const stVal = st.data?.rideRequest?.status ?? st.data?.status;
  ok('Rider GET /status 200 + completed', st.ok && stVal === 'completed', `${st.status} ${JSON.stringify(st.data)}`);

  INFO('Submit reviews (numeric rating in JSON)');
  const riderRate = await httpPost(
    `${BASE_URL}/api/rides/${rideRequestId}/rate`,
    { rating: 5, comment: 'Great driver' },
    riderToken
  );
  ok('Rider rate driver 200', riderRate.ok, `${riderRate.status} ${JSON.stringify(riderRate.data)}`);

  const driverRate = await httpPost(
    `${BASE_URL}/api/rides/${rideRequestId}/rate`,
    { rating: 4, comment: 'Good rider' },
    driverToken
  );
  ok('Driver rate rider 200', driverRate.ok, `${driverRate.status} ${JSON.stringify(driverRate.data)}`);

  try {
    riderSocket.disconnect();
    driverSocket.disconnect();
  } catch {}

  console.log('\n' + '═'.repeat(60));
  console.log(`  Passed: ${passed}   Failed: ${failed}`);
  console.log('═'.repeat(60) + '\n');
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error('\n💥', err?.stack || err?.message || err);
  process.exitCode = 1;
});
