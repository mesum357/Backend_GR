#!/usr/bin/env node
/**
 * E2E: Driver view count for FindingDriversModal.
 *
 * Validates:
 * 1) Rider creates ride request.
 * 2) Driver 1 opens request (emits ride_request_viewed) => rider gets viewedCount >= 1.
 * 3) Driver 2 opens request => rider gets viewedCount >= 2.
 * 4) Status API availableDrivers has exactly 2 viewed entries.
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
    rider: { email: `vc_rider_${ts}@example.com`, phone: `7${String(ts).slice(-9)}` },
    driver1: { email: `vc_driver1_${ts}@example.com`, phone: `6${String(ts).slice(-9)}` },
    driver2: { email: `vc_driver2_${ts}@example.com`, phone: `5${String(ts).slice(-9)}` },
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
  console.log(`\nDriver-view count E2E @ ${BASE_URL}\n`);
  const ts = Date.now();
  const u = users(ts);
  const PICKUP = { latitude: 35.9208, longitude: 74.3144, address: 'Gilgit City Center' };
  const DEST = { latitude: 35.935, longitude: 74.33, address: 'Jutial, Gilgit' };

  let riderSocket;
  let driver1Socket;
  let driver2Socket;
  try {
    await registerUser({ ...u.rider, userType: 'rider', firstName: 'Rider', lastName: 'Views' });
    await registerUser({ ...u.driver1, userType: 'driver', firstName: 'Driver', lastName: 'One', plate: `V1${String(ts).slice(-4)}` });
    await registerUser({ ...u.driver2, userType: 'driver', firstName: 'Driver', lastName: 'Two', plate: `V2${String(ts).slice(-4)}` });
    ok('Users registered', true);

    const rider = await login(u.rider.email, 'rider');
    const driver1 = await login(u.driver1.email, 'driver');
    const driver2 = await login(u.driver2.email, 'driver');
    ok('Users logged in', !!rider.token && !!driver1.token && !!driver2.token);

    riderSocket = await connectSocket('rider');
    driver1Socket = await connectSocket('driver1');
    driver2Socket = await connectSocket('driver2');
    riderSocket.emit('authenticate', { userId: rider.user._id, userType: 'rider' });
    driver1Socket.emit('authenticate', { userId: driver1.user._id, userType: 'driver' });
    driver2Socket.emit('authenticate', { userId: driver2.user._id, userType: 'driver' });
    ok('Sockets connected/authenticated', true);

    await http('POST', `${BASE_URL}/api/drivers/location`, driver1.token, {
      latitude: PICKUP.latitude + 0.001, longitude: PICKUP.longitude + 0.001,
    });
    await http('POST', `${BASE_URL}/api/drivers/location`, driver2.token, {
      latitude: PICKUP.latitude + 0.0015, longitude: PICKUP.longitude + 0.0015,
    });

    const req = await http('POST', `${BASE_URL}/api/ride-requests/request-ride`, rider.token, {
      pickup: PICKUP, destination: DEST, offeredFare: 240, radiusMeters: 5000, paymentMethod: 'cash', vehicleType: 'any', notes: 'view-count-e2e',
    });
    const rideId = String(req.data?.rideRequest?.id || '');
    ok('Ride request created', req.status === 201 && !!rideId, JSON.stringify(req.data));

    const view1P = waitEvent(
      riderSocket,
      'ride_request_viewed',
      (d) => String(d?.rideRequestId || '') === rideId && Number(d?.viewedCount || 0) >= 1,
      12000
    );
    driver1Socket.emit('ride_request_viewed', {
      rideRequestId: rideId,
      driverId: driver1.user._id,
      timestamp: Date.now(),
    });
    const view1 = await view1P;
    ok('Rider receives viewed count after driver 1 opens modal', Number(view1?.viewedCount || 0) >= 1, JSON.stringify(view1));

    const view2P = waitEvent(
      riderSocket,
      'ride_request_viewed',
      (d) => String(d?.rideRequestId || '') === rideId && Number(d?.viewedCount || 0) >= 2,
      12000
    );
    driver2Socket.emit('ride_request_viewed', {
      rideRequestId: rideId,
      driverId: driver2.user._id,
      timestamp: Date.now(),
    });
    const view2 = await view2P;
    ok('Rider receives viewed count after driver 2 opens modal', Number(view2?.viewedCount || 0) >= 2, JSON.stringify(view2));

    await sleep(500);
    const status = await http('GET', `${BASE_URL}/api/ride-requests/${rideId}/status`, rider.token);
    const availableDrivers = status.data?.rideRequest?.availableDrivers || [];
    const viewedCountFromStatus = availableDrivers.filter((d) => !!d?.viewedAt || d?.status === 'viewed').length;
    ok('Status API reflects two viewed drivers', viewedCountFromStatus >= 2, `viewed=${viewedCountFromStatus}`);
  } catch (e) {
    ok('Unhandled test error', false, e.message);
  } finally {
    try { riderSocket?.disconnect(); } catch {}
    try { driver1Socket?.disconnect(); } catch {}
    try { driver2Socket?.disconnect(); } catch {}
  }

  console.log(`\nDone. Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

run();

