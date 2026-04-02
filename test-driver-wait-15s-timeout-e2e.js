#!/usr/bin/env node
/**
 * E2E: Driver accept -> must receive fare_response_timeout in ~15s if rider doesn't respond.
 *
 * This validates the socket events that drive the driver app's 15s waiting dialog.
 */
const fetch = require('node-fetch').default;
const io = require('socket.io-client');

const LOCAL_PORT = process.env.LOCAL_API_PORT || '8080';
const LOCAL_DEFAULT = `http://127.0.0.1:${LOCAL_PORT}`;
const USE_LOCAL_ONLY = process.env.LOCAL_ONLY === '1' || process.env.LOCAL_ONLY === 'true';
const BASE_URL = (USE_LOCAL_ONLY ? LOCAL_DEFAULT : (process.env.API_URL || process.env.BASE_URL || LOCAL_DEFAULT)).replace(/\/$/, '');

const PASSWORD = process.env.PASSWORD || 'password123';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@gbrides.pk';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin12345';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, url, token, body) {
  const headers = { Accept: 'application/json' };
  if (body != null) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.HTTP_TIMEOUT_MS || 20000));
  const res = await fetch(url, {
    method,
    headers,
    signal: controller.signal,
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  }).finally(() => clearTimeout(timeout));
  let data = {};
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

function connectSocket(label) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE_URL, { transports: ['websocket'], timeout: 20000 });
    const t = setTimeout(() => reject(new Error(`${label} socket timeout`)), 21000);
    socket.on('connect', () => { clearTimeout(t); resolve(socket); });
    socket.on('connect_error', (err) => { clearTimeout(t); reject(err); });
  });
}

function waitEvent(socket, event, match, timeoutMs = 15000) {
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
    rider: { email: `wait_rider_${ts}@example.com`, phone: `7${String(ts).slice(-9)}` },
    driver: { email: `wait_driver_${ts}@example.com`, phone: `6${String(ts).slice(-9)}` },
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
  if (!r.ok) throw new Error(`register ${userType} failed (${r.status}) ${JSON.stringify(r.data?.error || r.data)}`);
}

async function login(email, expectedUserType) {
  const r = await http('POST', `${BASE_URL}/api/auth/login`, null, { email, password: PASSWORD, expectedUserType });
  if (!r.ok) throw new Error(`login ${expectedUserType} failed (${r.status}) ${JSON.stringify(r.data?.error || r.data)}`);
  return { token: r.data.token, user: r.data.user };
}

async function adminLogin() {
  const r = await http('POST', `${BASE_URL}/api/admin/auth/login`, null, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (!r.ok) throw new Error(`admin login failed (${r.status}) ${JSON.stringify(r.data?.error || r.data)}`);
  return r.data.token;
}

async function approveDriverByEmail(adminToken, driverEmail) {
  const list = await http('GET', `${BASE_URL}/api/admin/driver-requests?status=pending`, adminToken);
  if (!list.ok) throw new Error(`list driver-requests failed (${list.status}) ${JSON.stringify(list.data?.error || list.data)}`);
  const requests = Array.isArray(list.data?.requests) ? list.data.requests : [];
  const match = requests.find((d) => String(d?.user?.email || '').toLowerCase() === String(driverEmail).toLowerCase());
  if (!match?._id) throw new Error(`pending driver request not found for ${driverEmail}`);
  const approve = await http('PATCH', `${BASE_URL}/api/admin/driver-requests/${match._id}/approve`, adminToken, {});
  if (!approve.ok) throw new Error(`approve driver failed (${approve.status}) ${JSON.stringify(approve.data?.error || approve.data)}`);
}

async function setMinimumDriverWallet(adminToken, value) {
  const r = await http('PATCH', `${BASE_URL}/api/admin/wallet/settings`, adminToken, { driverMinimumWalletPkr: value });
  if (!r.ok) throw new Error(`patch wallet settings failed (${r.status}) ${JSON.stringify(r.data?.error || r.data)}`);
}

async function run() {
  console.log(`\nDriver wait-timeout E2E @ ${BASE_URL}\n`);
  const ts = Date.now();
  const u = users(ts);
  const PICKUP = { latitude: 35.9208, longitude: 74.3144, address: 'Gilgit City Center' };
  const DEST = { latitude: 35.935, longitude: 74.33, address: 'Jutial, Gilgit' };

  let riderSocket;
  let driverSocket;
  try {
    await registerUser({ ...u.rider, userType: 'rider', firstName: 'Rider', lastName: 'Wait' });
    await registerUser({ ...u.driver, userType: 'driver', firstName: 'Driver', lastName: 'Wait', plate: `WT${String(ts).slice(-4)}` });

    const adminToken = await adminLogin();
    await setMinimumDriverWallet(adminToken, 0);
    await approveDriverByEmail(adminToken, u.driver.email);

    const rider = await login(u.rider.email, 'rider');
    const driver = await login(u.driver.email, 'driver');

    riderSocket = await connectSocket('rider');
    driverSocket = await connectSocket('driver');
    riderSocket.emit('authenticate', { userId: rider.user._id, userType: 'rider' });
    driverSocket.emit('authenticate', { userId: driver.user._id, userType: 'driver' });

    // Ensure driver online + location
    await http('POST', `${BASE_URL}/api/drivers/toggle-status`, driver.token, {});
    await http('POST', `${BASE_URL}/api/drivers/location`, driver.token, {
      latitude: PICKUP.latitude + 0.001,
      longitude: PICKUP.longitude + 0.001,
    });

    const driverReqP = waitEvent(driverSocket, 'ride_request', null, 15000);
    const req = await http('POST', `${BASE_URL}/api/ride-requests/request-ride`, rider.token, {
      pickup: PICKUP,
      destination: DEST,
      offeredFare: 200,
      radiusMeters: 5000,
      paymentMethod: 'cash',
      vehicleType: 'any',
      notes: 'driver-wait-timeout-test',
    });
    const rideRequestId = String(req.data?.rideRequest?.id || '');
    if (!(req.status === 201 && rideRequestId)) throw new Error(`request-ride failed (${req.status}) ${JSON.stringify(req.data)}`);

    const evt = await driverReqP;
    if (String(evt?.rideRequestId || '') !== rideRequestId) throw new Error(`ride_request mismatch: ${JSON.stringify(evt)}`);

    // Driver sends accept (offer) via REST like the real driver app does.
    const offerToRiderP = waitEvent(riderSocket, 'fare_offer', (d) => String(d?.rideRequestId) === rideRequestId, 15000);
    const timeoutP = waitEvent(driverSocket, 'fare_response_timeout', (d) => String(d?.rideRequestId || '') === rideRequestId, 25000);

    const acceptRes = await http('POST', `${BASE_URL}/api/ride-requests/${rideRequestId}/respond`, driver.token, {
      action: 'accept',
    });
    if (!acceptRes.ok) throw new Error(`driver accept via REST failed (${acceptRes.status}) ${JSON.stringify(acceptRes.data?.error || acceptRes.data)}`);

    await offerToRiderP; // ensure offer emitted
    console.log('✓ Rider received fare_offer');

    // Rider intentionally does nothing. Expect timeout event.
    const t0 = Date.now();
    await timeoutP;
    const elapsed = Date.now() - t0;
    console.log(`✓ Driver received fare_response_timeout after ~${Math.round(elapsed / 1000)}s`);

    console.log('\n✅ PASS\n');
  } finally {
    try { riderSocket?.disconnect(); } catch {}
    try { driverSocket?.disconnect(); } catch {}
    await sleep(150);
  }
}

run().catch((e) => {
  console.error('\n❌ FAIL:', e?.message || e);
  process.exitCode = 1;
});

