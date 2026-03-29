#!/usr/bin/env node
/**
 * GB RIDES — Multi-request + fare update + multi-offer E2E
 *
 * Validates:
 * 1) Multiple rider requests are visible in driver dashboard API.
 * 2) Rider fare adjustment updates existing request (does not cancel it).
 * 3) Multiple drivers can send offers for the same ride.
 * 4) Rider receives multiple fare_offer events for the same rideRequestId.
 */

const fetch = require('node-fetch').default;
const io = require('socket.io-client');

const LOCAL_PORT = process.env.LOCAL_API_PORT || '8080';
const LOCAL_DEFAULT = `http://127.0.0.1:${LOCAL_PORT}`;
const USE_LOCAL_ONLY = process.env.LOCAL_ONLY === '1' || process.env.LOCAL_ONLY === 'true';
const BASE_URL = (USE_LOCAL_ONLY ? LOCAL_DEFAULT : (process.env.API_URL || process.env.BASE_URL || LOCAL_DEFAULT)).replace(/\/$/, '');
const PASSWORD = 'password123';

const PASS = (m) => console.log(`  [PASS] ${m}`);
const FAIL = (m) => console.log(`  [FAIL] ${m}`);
const INFO = (m) => console.log(`  [INFO] ${m}`);
let passed = 0;
let failed = 0;

function ok(label, condition, detail = '') {
  if (condition) {
    PASS(label);
    passed++;
  } else {
    FAIL(`${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpRequest(method, url, token, body) {
  const headers = { Accept: 'application/json' };
  if (body != null) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { ok: res.ok, status: res.status, data };
}

function waitForMatchingEvent(socket, event, matcher, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout waiting for ${event}`));
    }, timeoutMs);
    const handler = (data) => {
      if (matcher(data)) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(data);
      }
    };
    socket.on(event, handler);
  });
}

function connectSocket(label) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE_URL, { transports: ['websocket'], timeout: 15000 });
    const t = setTimeout(() => reject(new Error(`${label} socket timeout`)), 16000);
    socket.on('connect', () => {
      clearTimeout(t);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(t);
      reject(new Error(`${label} socket error: ${err.message}`));
    });
  });
}

function buildUsers(ts) {
  return {
    rider1: { email: `mr_rider1_${ts}@example.com`, phone: `7${String(ts).slice(-9)}` },
    rider2: { email: `mr_rider2_${ts}@example.com`, phone: `8${String(ts).slice(-9)}` },
    driver1: { email: `mr_driver1_${ts}@example.com`, phone: `6${String(ts).slice(-9)}` },
    driver2: { email: `mr_driver2_${ts}@example.com`, phone: `5${String(ts).slice(-9)}` },
  };
}

async function registerUser({ email, phone, userType, firstName, lastName, plate }) {
  const payload = {
    email,
    password: PASSWORD,
    firstName,
    lastName,
    phone,
    userType,
    ...(userType === 'driver'
      ? {
          driverInfo: {
            vehicleInfo: {
              make: 'Test',
              model: 'Car',
              year: 2018,
              color: 'Black',
              plateNumber: plate,
              vehicleType: 'car',
            },
            licenseNumber: `LIC-${plate}`,
            licenseExpiry: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
            insuranceNumber: `INS-${plate}`,
            insuranceExpiry: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
          },
        }
      : {}),
  };
  const r = await httpRequest('POST', `${BASE_URL}/api/auth/register`, null, payload);
  if (!r.ok) throw new Error(`register ${userType} failed: ${r.status}`);
}

async function login(email, expectedUserType) {
  const r = await httpRequest('POST', `${BASE_URL}/api/auth/login`, null, {
    email,
    password: PASSWORD,
    expectedUserType,
  });
  if (!r.ok) throw new Error(`login ${expectedUserType} failed: ${r.status}`);
  return { token: r.data.token, user: r.data.user };
}

async function main() {
  console.log(`\nRunning multi-request E2E on ${BASE_URL}\n`);
  const ts = Date.now();
  const users = buildUsers(ts);

  const PICKUP = { latitude: 35.9208, longitude: 74.3144, address: 'Gilgit City Center' };
  const DEST_A = { latitude: 35.935, longitude: 74.33, address: 'Jutial, Gilgit' };
  const DEST_B = { latitude: 35.93, longitude: 74.32, address: 'Kashrote, Gilgit' };

  let riderSocket = null;
  let driver1Socket = null;
  let driver2Socket = null;

  try {
    INFO('Registering users');
    await registerUser({ ...users.rider1, userType: 'rider', firstName: 'Rider', lastName: 'One' });
    await registerUser({ ...users.rider2, userType: 'rider', firstName: 'Rider', lastName: 'Two' });
    await registerUser({ ...users.driver1, userType: 'driver', firstName: 'Driver', lastName: 'One', plate: `D1${String(ts).slice(-4)}` });
    await registerUser({ ...users.driver2, userType: 'driver', firstName: 'Driver', lastName: 'Two', plate: `D2${String(ts).slice(-4)}` });
    ok('Users registered', true);

    const rider1 = await login(users.rider1.email, 'rider');
    const rider2 = await login(users.rider2.email, 'rider');
    const driver1 = await login(users.driver1.email, 'driver');
    const driver2 = await login(users.driver2.email, 'driver');
    ok('All users logged in', !!rider1.token && !!rider2.token && !!driver1.token && !!driver2.token);

    riderSocket = await connectSocket('rider');
    driver1Socket = await connectSocket('driver1');
    driver2Socket = await connectSocket('driver2');
    riderSocket.emit('authenticate', { userId: rider1.user._id, userType: 'rider' });
    driver1Socket.emit('authenticate', { userId: driver1.user._id, userType: 'driver' });
    driver2Socket.emit('authenticate', { userId: driver2.user._id, userType: 'driver' });
    ok('Sockets connected/authenticated', true);

    await httpRequest('POST', `${BASE_URL}/api/drivers/location`, driver1.token, {
      latitude: PICKUP.latitude + 0.001,
      longitude: PICKUP.longitude + 0.001,
    });
    await httpRequest('POST', `${BASE_URL}/api/drivers/location`, driver2.token, {
      latitude: PICKUP.latitude + 0.0015,
      longitude: PICKUP.longitude + 0.0015,
    });

    const req1 = await httpRequest('POST', `${BASE_URL}/api/ride-requests/request-ride`, rider1.token, {
      pickup: PICKUP,
      destination: DEST_A,
      offeredFare: 200,
      radiusMeters: 5000,
      paymentMethod: 'cash',
      vehicleType: 'any',
      notes: 'multi request test 1',
    });
    ok('Ride request #1 created', req1.status === 201, JSON.stringify(req1.data));
    const rideId1 = String(req1.data?.rideRequest?.id || '');

    const req2 = await httpRequest('POST', `${BASE_URL}/api/ride-requests/request-ride`, rider2.token, {
      pickup: PICKUP,
      destination: DEST_B,
      offeredFare: 260,
      radiusMeters: 5000,
      paymentMethod: 'cash',
      vehicleType: 'any',
      notes: 'multi request test 2',
    });
    ok('Ride request #2 created', req2.status === 201, JSON.stringify(req2.data));
    const rideId2 = String(req2.data?.rideRequest?.id || '');

    await sleep(800);
    const available = await httpRequest('GET', `${BASE_URL}/api/ride-requests/available-simple`, driver1.token);
    const ids = (available.data?.rideRequests || []).map((r) => String(r.id || r._id));
    ok('Driver sees both ride requests', ids.includes(rideId1) && ids.includes(rideId2), JSON.stringify(ids));

    const fareUpdate = await httpRequest('PATCH', `${BASE_URL}/api/ride-requests/${rideId1}/fare`, rider1.token, {
      offeredFare: 350,
    });
    ok('Rider fare update succeeded', fareUpdate.ok, JSON.stringify(fareUpdate.data));

    await sleep(600);
    const availableAfterFare = await httpRequest('GET', `${BASE_URL}/api/ride-requests/available-simple`, driver1.token);
    const reqAfterFare = (availableAfterFare.data?.rideRequests || []).find((r) => String(r.id || r._id) === rideId1);
    const statusRes = await httpRequest('GET', `${BASE_URL}/api/ride-requests/${rideId1}/status`, rider1.token);
    const status = statusRes.data?.rideRequest?.status || statusRes.data?.status;
    ok('Ride not cancelled after fare update', status !== 'cancelled', `status=${status}`);
    ok(
      'Driver sees updated fare in dashboard API',
      Number(reqAfterFare?.requestedPrice || reqAfterFare?.estimatedFare) === 350,
      `got=${reqAfterFare?.requestedPrice || reqAfterFare?.estimatedFare}`
    );

    const offerFromDriver1 = waitForMatchingEvent(
      riderSocket,
      'fare_offer',
      (e) => String(e?.rideRequestId) === rideId1 && String(e?.driverId) === String(driver1.user._id),
      12000
    );
    const offerFromDriver2 = waitForMatchingEvent(
      riderSocket,
      'fare_offer',
      (e) => String(e?.rideRequestId) === rideId1 && String(e?.driverId) === String(driver2.user._id),
      12000
    );

    const d1Respond = await httpRequest('POST', `${BASE_URL}/api/ride-requests/${rideId1}/respond`, driver1.token, {
      action: 'accept',
      counterOffer: 345,
    });
    const d2Respond = await httpRequest('POST', `${BASE_URL}/api/ride-requests/${rideId1}/respond`, driver2.token, {
      action: 'accept',
      counterOffer: 340,
    });
    ok('Driver 1 offer API success', d1Respond.ok, JSON.stringify(d1Respond.data));
    ok('Driver 2 offer API success', d2Respond.ok, JSON.stringify(d2Respond.data));

    const [evt1, evt2] = await Promise.all([offerFromDriver1, offerFromDriver2]);
    ok('Rider received fare offer from driver 1', !!evt1);
    ok('Rider received fare offer from driver 2', !!evt2);

    const uniqueDrivers = new Set([String(evt1?.driverId), String(evt2?.driverId)]);
    ok('Rider received multiple driver offers in same ride', uniqueDrivers.size >= 2, JSON.stringify([...uniqueDrivers]));
  } catch (e) {
    failed++;
    FAIL(`Unhandled error: ${e.message}`);
  } finally {
    try { riderSocket?.disconnect(); } catch {}
    try { driver1Socket?.disconnect(); } catch {}
    try { driver2Socket?.disconnect(); } catch {}
  }

  console.log(`\nDone. Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main();

