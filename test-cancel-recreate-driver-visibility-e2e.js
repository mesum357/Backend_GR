#!/usr/bin/env node
/**
 * E2E: Rider cancels request, recreates, driver should still see new request.
 */
const fetch = require('node-fetch').default;
const io = require('socket.io-client');

const LOCAL_PORT = process.env.LOCAL_API_PORT || '8080';
const LOCAL_DEFAULT = `http://127.0.0.1:${LOCAL_PORT}`;
const USE_LOCAL_ONLY = process.env.LOCAL_ONLY === '1' || process.env.LOCAL_ONLY === 'true';
const BASE_URL = (USE_LOCAL_ONLY ? LOCAL_DEFAULT : (process.env.API_URL || process.env.BASE_URL || LOCAL_DEFAULT)).replace(/\/$/, '');
const PASSWORD = 'password123';

let passed = 0;
let failed = 0;
const ok = (label, cond, detail = '') => {
  if (cond) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, url, token, body) {
  const headers = { Accept: 'application/json' };
  if (body != null) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, ...(body != null ? { body: JSON.stringify(body) } : {}) });
  let data = {};
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

function connectSocket(label) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE_URL, { transports: ['websocket'], timeout: 15000 });
    const t = setTimeout(() => reject(new Error(`${label} socket timeout`)), 16000);
    socket.on('connect', () => { clearTimeout(t); resolve(socket); });
    socket.on('connect_error', (err) => { clearTimeout(t); reject(err); });
  });
}

function waitEvent(socket, event, match, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    const handler = (data) => {
      if (!match || match(data)) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(data);
      }
    };
    socket.on(event, handler);
  });
}

function users(ts) {
  return {
    rider: { email: `cr_rider_${ts}@example.com`, phone: `7${String(ts).slice(-9)}` },
    driver: { email: `cr_driver_${ts}@example.com`, phone: `6${String(ts).slice(-9)}` },
  };
}

async function registerUser({ email, phone, userType, firstName, lastName, plate }) {
  const payload = {
    email, phone, firstName, lastName, password: PASSWORD, userType,
    ...(userType === 'driver' ? {
      driverInfo: {
        vehicleInfo: { make: 'Test', model: 'Car', year: 2018, color: 'Black', plateNumber: plate, vehicleType: 'car' },
        licenseNumber: `LIC-${plate}`,
        licenseExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        insuranceNumber: `INS-${plate}`,
        insuranceExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      },
    } : {}),
  };
  const r = await http('POST', `${BASE_URL}/api/auth/register`, null, payload);
  if (!r.ok) throw new Error(`register ${userType} failed`);
}

async function login(email, expectedUserType) {
  const r = await http('POST', `${BASE_URL}/api/auth/login`, null, { email, password: PASSWORD, expectedUserType });
  if (!r.ok) throw new Error(`login ${expectedUserType} failed`);
  return { token: r.data.token, user: r.data.user };
}

async function run() {
  console.log(`\nCancel/Recreate visibility E2E @ ${BASE_URL}\n`);
  const ts = Date.now();
  const u = users(ts);
  const PICKUP = { latitude: 35.9208, longitude: 74.3144, address: 'Gilgit City Center' };
  const DEST = { latitude: 35.935, longitude: 74.33, address: 'Jutial, Gilgit' };

  let riderSocket;
  let driverSocket;
  try {
    await registerUser({ ...u.rider, userType: 'rider', firstName: 'Rider', lastName: 'Cancel' });
    await registerUser({ ...u.driver, userType: 'driver', firstName: 'Driver', lastName: 'Dash', plate: `CR${String(ts).slice(-4)}` });
    ok('Users registered', true);

    const rider = await login(u.rider.email, 'rider');
    const driver = await login(u.driver.email, 'driver');
    ok('Users logged in', !!rider.token && !!driver.token);

    riderSocket = await connectSocket('rider');
    driverSocket = await connectSocket('driver');
    riderSocket.emit('authenticate', { userId: rider.user._id, userType: 'rider' });
    driverSocket.emit('authenticate', { userId: driver.user._id, userType: 'driver' });
    ok('Sockets connected/authenticated', true);

    await http('POST', `${BASE_URL}/api/drivers/location`, driver.token, {
      latitude: PICKUP.latitude + 0.001,
      longitude: PICKUP.longitude + 0.001,
    });

    const firstReqEventP = waitEvent(driverSocket, 'ride_request', null, 12000);
    const req1 = await http('POST', `${BASE_URL}/api/ride-requests/request-ride`, rider.token, {
      pickup: PICKUP, destination: DEST, offeredFare: 200, radiusMeters: 5000, paymentMethod: 'cash', vehicleType: 'any', notes: 'cancel-recreate #1',
    });
    const ride1 = String(req1.data?.rideRequest?.id || '');
    ok('First ride request created', req1.status === 201 && !!ride1, JSON.stringify(req1.data));
    const firstEvt = await firstReqEventP;
    ok('Driver got first ride_request event', String(firstEvt?.rideRequestId || '') === ride1, JSON.stringify(firstEvt));

    const cancelEvtP = Promise.race([
      waitEvent(driverSocket, 'ride_request_cancelled', (d) => String(d?.rideRequestId) === ride1, 12000),
      waitEvent(driverSocket, 'ride_cancelled', (d) => String(d?.rideRequestId) === ride1, 12000),
    ]);
    const cancelRes = await http('POST', `${BASE_URL}/api/ride-requests/${ride1}/cancel`, rider.token, {});
    ok('Rider cancel first request success', cancelRes.ok, JSON.stringify(cancelRes.data));
    await cancelEvtP;
    ok('Driver got cancellation event for first request', true);

    const secondReqEventP = waitEvent(driverSocket, 'ride_request', null, 12000);
    const req2 = await http('POST', `${BASE_URL}/api/ride-requests/request-ride`, rider.token, {
      pickup: PICKUP, destination: DEST, offeredFare: 230, radiusMeters: 5000, paymentMethod: 'cash', vehicleType: 'any', notes: 'cancel-recreate #2',
    });
    const ride2 = String(req2.data?.rideRequest?.id || '');
    ok('Second ride request created', req2.status === 201 && !!ride2 && ride2 !== ride1, JSON.stringify(req2.data));
    const secondEvt = await secondReqEventP;
    ok('Driver got second ride_request event', String(secondEvt?.rideRequestId || '') === ride2, JSON.stringify(secondEvt));

    await sleep(600);
    const avail = await http('GET', `${BASE_URL}/api/ride-requests/available-simple`, driver.token);
    const ids = (avail.data?.rideRequests || []).map((r) => String(r.id || r._id));
    ok('Driver dashboard API includes recreated request', ids.includes(ride2), JSON.stringify(ids));
    ok('Driver dashboard API excludes cancelled request', !ids.includes(ride1), JSON.stringify(ids));

    // Regression guard: ensure driver can still respond to the recreated request.
    const respond2 = await http('POST', `${BASE_URL}/api/ride-requests/${ride2}/respond`, driver.token, {
      action: 'counter_offer',
      counterOffer: 225,
    });
    ok('Driver can respond to recreated request (counter offer)', respond2.ok, JSON.stringify(respond2.data));
  } catch (e) {
    ok('Unhandled test error', false, e.message);
  } finally {
    try { riderSocket?.disconnect(); } catch {}
    try { driverSocket?.disconnect(); } catch {}
  }

  console.log(`\nDone. Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

run();

