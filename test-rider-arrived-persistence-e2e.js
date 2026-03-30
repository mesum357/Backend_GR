#!/usr/bin/env node
/**
 * E2E: rider presses "I am here" -> riderArrivedAt persists in status API.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForAssignment(rideId, riderToken, expectedDriverId, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await http('GET', `${BASE_URL}/api/ride-requests/${rideId}/status`, riderToken);
    const rr = status.data?.rideRequest || {};
    const acceptedBy = String(rr.acceptedBy || '');
    if (acceptedBy && acceptedBy === String(expectedDriverId)) {
      return rr;
    }
    await sleep(400);
  }
  throw new Error('timeout waiting for ride assignment');
}

function users(ts) {
  return {
    rider: { email: `rah_rider_${ts}@example.com`, phone: `7${String(ts).slice(-9)}` },
    driver: { email: `rah_driver_${ts}@example.com`, phone: `6${String(ts).slice(-9)}` },
  };
}

async function registerUser({ email, phone, userType, firstName, lastName, plate }) {
  const payload = {
    email, phone, firstName, lastName, password: PASSWORD, userType,
    ...(userType === 'driver'
      ? {
          driverInfo: {
            vehicleInfo: { make: 'Test', model: 'Car', year: 2018, color: 'Black', plateNumber: plate, vehicleType: 'car' },
            licenseNumber: `LIC-${plate}`,
            licenseExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            insuranceNumber: `INS-${plate}`,
            insuranceExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          },
        }
      : {}),
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
  console.log(`\nRider-arrived persistence E2E @ ${BASE_URL}\n`);
  const ts = Date.now();
  const u = users(ts);
  const PICKUP = { latitude: 35.9208, longitude: 74.3144, address: 'Gilgit City Center' };
  const DEST = { latitude: 35.935, longitude: 74.33, address: 'Jutial, Gilgit' };

  let riderSocket;
  let driverSocket;
  try {
    await registerUser({ ...u.rider, userType: 'rider', firstName: 'Rider', lastName: 'Arrived' });
    await registerUser({ ...u.driver, userType: 'driver', firstName: 'Driver', lastName: 'Arrived', plate: `RA${String(ts).slice(-4)}` });
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

    const req = await http('POST', `${BASE_URL}/api/ride-requests/request-ride`, rider.token, {
      pickup: PICKUP, destination: DEST, offeredFare: 220, radiusMeters: 5000, paymentMethod: 'cash', vehicleType: 'any', notes: 'rider-arrived-persist',
    });
    const rideId = String(req.data?.rideRequest?.id || '');
    ok('Ride request created', req.status === 201 && !!rideId, JSON.stringify(req.data));

    const acceptRes = await http('POST', `${BASE_URL}/api/ride-requests/${rideId}/respond`, driver.token, {
      action: 'counter_offer',
      counterOffer: 220,
    });
    ok('Driver sent counter offer', acceptRes.ok, JSON.stringify(acceptRes.data));

    const riderAcceptCounter = await http(
      'POST',
      `${BASE_URL}/api/ride-requests/${rideId}/accept-counter-offer`,
      rider.token,
      { driverId: driver.user._id }
    );
    ok('Rider accepted counter offer', riderAcceptCounter.ok, JSON.stringify(riderAcceptCounter.data));

    await waitForAssignment(rideId, rider.token, driver.user._id, 12000);

    const riderArrivedEvent = waitEvent(
      driverSocket,
      'rider_at_pickup',
      (d) => String(d?.rideRequestId || '') === rideId,
      12000
    );
    riderSocket.emit('rider_arrived', {
      rideRequestId: rideId,
      riderId: rider.user._id,
      latitude: PICKUP.latitude,
      longitude: PICKUP.longitude,
    });
    await riderArrivedEvent;
    ok('Driver received rider_at_pickup event', true);

    await sleep(500);
    const status = await http('GET', `${BASE_URL}/api/ride-requests/${rideId}/status`, rider.token);
    const riderArrivedAt = status.data?.rideRequest?.riderArrivedAt || status.data?.riderArrivedAt;
    ok('Status API returns riderArrivedAt', !!riderArrivedAt, JSON.stringify(status.data));
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

