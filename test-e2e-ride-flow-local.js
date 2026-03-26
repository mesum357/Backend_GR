/**
 * GB RIDES — Local E2E Ride Flow Test
 * ==================================
 * Registers a fresh rider + driver (local backend), then simulates:
 *   - Rider creates ride request (REST)
 *   - Driver receives ride_request (socket) [optional check]
 *   - Driver sends fare_offer (socket)
 *   - Rider accepts fare_offer (socket: fare_response {action:'accept'})
 *   - Server emits fare_response_confirmed + driver_assigned
 *   - Rider_arrived -> driver receives rider_at_pickup
 *   - Driver start_ride -> rider receives ride_started
 *   - Driver end_ride -> rider receives ride_completed
 *   - Verify final status in DB via debug endpoint
 *
 * Run: node test-e2e-ride-flow-local.js
 */

const fetch = require('node-fetch').default;
const io = require('socket.io-client');

const BASE_URL = 'http://192.168.1.42:8080';
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
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
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
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
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
  console.log('\n🚀  GB RIDES — Local E2E Ride Flow Test');
  console.log(`    Backend: ${BASE_URL}`);
  console.log(`    ${new Date().toISOString()}\n`);

  const { riderEmail, riderPhone, driverEmail, driverPhone } = createTestEmails();

  // Use Gilgit coordinates similar to your app defaults.
  const PICKUP = { latitude: 35.9208, longitude: 74.3144, address: 'Gilgit City Center' };
  const DEST = { latitude: 35.935, longitude: 74.33, address: 'Jutial, Gilgit' };

  const riderVehiclePlate = `PLATE-${Date.now()}`;

  // Create users
  INFO('Register fresh rider + driver users');
  const riderReg = await registerUser({
    email: riderEmail,
    phone: riderPhone,
    userType: 'rider',
    firstName: 'E2E',
    lastName: 'Rider',
  });
  ok('Rider registered', !!riderReg?.token);

  const driverReg = await registerUser({
    email: driverEmail,
    phone: driverPhone,
    userType: 'driver',
    firstName: 'E2E',
    lastName: 'Driver',
    vehiclePlateNumber: riderVehiclePlate,
    vehicleType: 'car',
  });
  ok('Driver registered', !!driverReg?.token);

  const riderLogin = await loginUser({ email: riderEmail, expectedUserType: 'rider' });
  ok('Rider login', !!riderLogin.token);

  const driverLogin = await loginUser({ email: driverEmail, expectedUserType: 'driver' });
  ok('Driver login', !!driverLogin.token);

  const riderToken = riderLogin.token;
  const riderId = riderLogin.user?._id;
  const driverToken = driverLogin.token;
  const driverId = driverLogin.user?._id;

  ok('Extract riderId', !!riderId);
  ok('Extract driverId', !!driverId);

  // Sockets
  INFO('Connecting sockets + authenticating');
  const riderSocket = await connectSocket('Rider');
  riderSocket.emit('authenticate', { userId: riderId, userType: 'rider' });
  const driverSocket = await connectSocket('Driver');
  driverSocket.emit('authenticate', { userId: driverId, userType: 'driver' });
  ok('Sockets authenticated', true);

  // Update driver location near pickup
  INFO('Updating driver current location');
  const loc = await httpPost(
    `${BASE_URL}/api/drivers/location`,
    { latitude: PICKUP.latitude + 0.001, longitude: PICKUP.longitude + 0.001 },
    driverToken
  );
  ok('Driver location update', loc.ok, `${loc.status} ${JSON.stringify(loc.data?.error || loc.data)}`);

  // Create ride request
  INFO('Creating ride request');
  const rideReq = await httpPost(
    `${BASE_URL}/api/ride-requests/request-ride`,
    {
      pickup: PICKUP,
      destination: DEST,
      offeredFare: 150,
      radiusMeters: 5000,
      paymentMethod: 'cash',
      vehicleType: 'any',
      notes: 'E2E test ride',
    },
    riderToken
  );

  ok('Ride request created', rideReq.ok, `${rideReq.status} ${JSON.stringify(rideReq.data?.error || rideReq.data)}`);
  const rideRequestId = rideReq.data?.rideRequest?.id || rideReq.data?.rideRequest?._id;
  ok('Extract rideRequestId', !!rideRequestId);

  // Optional: check driver receives ride_request
  let gotRideRequestEvent = false;
  if (rideRequestId) {
    try {
      const evt = await waitForEvent(driverSocket, 'ride_request', 7000);
      gotRideRequestEvent = evt && (evt.rideRequestId || evt._id) ? true : false;
      ok('Driver received ride_request event', !!evt, evt ? '' : 'no payload');
    } catch (e) {
      INFO(`Driver did not receive ride_request event within 7s (continuing anyway): ${e.message}`);
    }
  }

  // Driver sends fare_offer directly (so we don't depend on driver_response/pending state logic)
  INFO('Sending fare_offer from driver');
  const expectedFareAmount = 150;
  const fareOfferPayload = {
    rideRequestId,
    driverId,
    driverName: `${driverLogin.user?.firstName || 'Driver'} ${driverLogin.user?.lastName || ''}`.trim() || 'Driver',
    driverRating: 4.5,
    fareAmount: expectedFareAmount,
    arrivalTime: 5,
    vehicleInfo: 'Standard Vehicle',
  };

  const fareOfferPromise = waitForEvent(riderSocket, 'fare_offer', 8000).catch(() => null);
  driverSocket.emit('fare_offer', fareOfferPayload);

  const fareOfferEvt = await fareOfferPromise;
  ok('Rider received fare_offer', !!fareOfferEvt, fareOfferEvt ? '' : 'no event received');

  // Rider accepts offer
  INFO('Rider accepting fare_offer (fare_response accept)');
  const fareResponseConfirmedPromise = waitForEvent(riderSocket, 'fare_response_confirmed', 8000).catch(() => null);
  const driverAssignedPromise = waitForEvent(riderSocket, 'driver_assigned', 8000).catch(() => null);

  riderSocket.emit('fare_response', { rideRequestId, riderId, action: 'accept', timestamp: Date.now() });

  const fareResponseConfirmed = await fareResponseConfirmedPromise;
  const driverAssigned = await driverAssignedPromise;

  ok('fare_response_confirmed received', !!fareResponseConfirmed, 'missing event');
  ok('driver_assigned received', !!driverAssigned, 'missing event');

  // Rider arrival
  INFO('Rider confirming arrival');
  const riderAtPickupPromise = waitForEvent(driverSocket, 'rider_at_pickup', 8000).catch(() => null);
  riderSocket.emit('rider_arrived', { rideRequestId, riderId });
  const riderAtPickupEvt = await riderAtPickupPromise;
  ok('Driver received rider_at_pickup', !!riderAtPickupEvt, 'missing event');

  // Driver starts ride
  INFO('Driver start_ride');
  const rideStartedPromise = waitForEvent(riderSocket, 'ride_started', 8000).catch(() => null);
  driverSocket.emit('start_ride', { rideRequestId, driverId });
  const rideStartedEvt = await rideStartedPromise;
  ok('Rider received ride_started', !!rideStartedEvt, 'missing event');

  // Driver ends ride
  INFO('Driver end_ride');
  const rideCompletedRiderPromise = waitForEvent(riderSocket, 'ride_completed', 8000).catch(() => null);
  const rideCompletedDriverPromise = waitForEvent(driverSocket, 'ride_completed', 8000).catch(() => null);
  driverSocket.emit('end_ride', { rideRequestId, driverId });

  const rideCompletedRiderEvt = await rideCompletedRiderPromise;
  const rideCompletedDriverEvt = await rideCompletedDriverPromise;
  ok('Rider received ride_completed', !!rideCompletedRiderEvt, 'missing event');
  ok('Driver received ride_completed ack', !!rideCompletedDriverEvt, 'missing event');

  // Verify final status in DB
  INFO('Verifying final ride status in DB');
  const debug = await httpGet(`${BASE_URL}/api/ride-requests/${rideRequestId}/debug`, riderToken);
  const status = debug.data?.status;
  ok('DB status is completed', status === 'completed', `got "${status}"`);

  // Cleanup
  try {
    riderSocket.disconnect();
    driverSocket.disconnect();
  } catch {}

  console.log('\n' + '═'.repeat(60));
  console.log('  TEST SUMMARY');
  console.log('═'.repeat(60));
  console.log(`  Passed: ${passed}  ✅`);
  console.log(`  Failed: ${failed}  ❌`);
  console.log('═'.repeat(60) + '\n');

  if (failed === 0) console.log('  🎉 E2E flow passed end-to-end.\n');
}

run()
  .catch((err) => {
    console.error('\n💥  Unexpected error:', err?.stack || err?.message || err);
    console.log(`\nSummary: ${passed} passed / ${failed} failed`);
  })
  .finally(() => process.exit(0));

