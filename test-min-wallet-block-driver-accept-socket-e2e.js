#!/usr/bin/env node
/**
 * E2E: Minimum wallet balance must block driver accept via SOCKET.
 *
 * Steps:
 * - register rider + driver
 * - admin approves driver
 * - admin sets driverMinimumWalletPkr (e.g. 500)
 * - force driver wallet balance (DB) to 0
 * - rider creates ride request
 * - driver attempts accept via socket driver_response
 * - EXPECT:
 *    - driver receives socket 'error' about insufficient wallet
 *    - rider does NOT receive 'fare_offer' for that request
 */
const fetch = require('node-fetch').default;
const io = require('socket.io-client');
const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const LOCAL_PORT = process.env.LOCAL_API_PORT || '8080';
const LOCAL_DEFAULT = `http://127.0.0.1:${LOCAL_PORT}`;
const USE_LOCAL_ONLY = process.env.LOCAL_ONLY === '1' || process.env.LOCAL_ONLY === 'true';
const BASE_URL = (USE_LOCAL_ONLY ? LOCAL_DEFAULT : (process.env.API_URL || process.env.BASE_URL || LOCAL_DEFAULT)).replace(/\/$/, '');

const PASSWORD = process.env.PASSWORD || 'password123';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@gbrides.pk';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin12345';
const MINIMUM = Number(process.env.MINIMUM_WALLET_PKR || 500);
const FORCE_BALANCE = Number(process.env.FORCE_DRIVER_BALANCE_PKR || 0);

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/tourist_app';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, url, token, body) {
  const headers = { Accept: 'application/json' };
  if (body != null) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
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
    rider: { email: `mw_rider_${ts}@example.com`, phone: `7${String(ts).slice(-9)}` },
    driver: { email: `mw_driver_${ts}@example.com`, phone: `6${String(ts).slice(-9)}` },
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
  return match._id;
}

async function setMinimumWallet(adminToken, value) {
  const r = await http('PATCH', `${BASE_URL}/api/admin/wallet/settings`, adminToken, { driverMinimumWalletPkr: value });
  if (!r.ok) throw new Error(`patch wallet settings failed (${r.status}) ${JSON.stringify(r.data?.error || r.data)}`);
}

async function forceDriverWalletBalance(userId, balance) {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  const Driver = require('./models/Driver');
  const doc = await Driver.findOne({ user: userId });
  if (!doc) throw new Error('Driver profile not found in DB');
  doc.wallet = doc.wallet || {};
  doc.wallet.balance = Number(balance);
  await doc.save();
  await mongoose.disconnect();
}

async function run() {
  console.log(`\nMin-wallet socket accept test @ ${BASE_URL}`);
  console.log(`- Minimum required: ${MINIMUM} PKR`);
  console.log(`- Forcing driver balance: ${FORCE_BALANCE} PKR`);
  const mongoSafe = String(MONGODB_URI).replace(/\/\/([^@]+)@/, '//***@');
  console.log(`- Mongo: ${mongoSafe}\n`);

  const ts = Date.now();
  const u = users(ts);
  const PICKUP = { latitude: 35.9208, longitude: 74.3144, address: 'Gilgit City Center' };
  const DEST = { latitude: 35.935, longitude: 74.33, address: 'Jutial, Gilgit' };

  let riderSocket;
  let driverSocket;

  try {
    await registerUser({ ...u.rider, userType: 'rider', firstName: 'Rider', lastName: 'MinWallet' });
    await registerUser({ ...u.driver, userType: 'driver', firstName: 'Driver', lastName: 'MinWallet', plate: `MW${String(ts).slice(-4)}` });

    const rider = await login(u.rider.email, 'rider');
    const adminToken = await adminLogin();
    await setMinimumWallet(adminToken, MINIMUM);
    await approveDriverByEmail(adminToken, u.driver.email);
    const driver = await login(u.driver.email, 'driver');

    await forceDriverWalletBalance(driver.user._id, FORCE_BALANCE);

    riderSocket = await connectSocket('rider');
    driverSocket = await connectSocket('driver');
    riderSocket.emit('authenticate', { userId: rider.user._id, userType: 'rider' });
    driverSocket.emit('authenticate', { userId: driver.user._id, userType: 'driver' });

    // Make driver online + set location.
    await http('POST', `${BASE_URL}/api/drivers/toggle-status`, driver.token, {});
    await http('POST', `${BASE_URL}/api/drivers/location`, driver.token, {
      latitude: PICKUP.latitude + 0.001,
      longitude: PICKUP.longitude + 0.001,
    });

    // Create request and wait for driver receive it.
    const driverReqP = waitEvent(driverSocket, 'ride_request', null, 15000);
    const req = await http('POST', `${BASE_URL}/api/ride-requests/request-ride`, rider.token, {
      pickup: PICKUP,
      destination: DEST,
      offeredFare: 300,
      radiusMeters: 5000,
      paymentMethod: 'cash',
      vehicleType: 'any',
      notes: 'min-wallet-test',
    });
    const rideRequestId = String(req.data?.rideRequest?.id || '');
    if (!(req.status === 201 && rideRequestId)) throw new Error(`request-ride failed (${req.status}) ${JSON.stringify(req.data)}`);
    const evt = await driverReqP;
    if (String(evt?.rideRequestId || '') !== rideRequestId) throw new Error(`ride_request mismatch: ${JSON.stringify(evt)}`);

    // Attempt accept via socket.
    const driverErrP = waitEvent(
      driverSocket,
      'error',
      (d) => String(d?.message || '').toLowerCase().includes('insufficient') || String(d?.message || '').toLowerCase().includes('minimum'),
      15000
    );

    // Rider should NOT get fare_offer.
    const riderOfferP = waitEvent(riderSocket, 'fare_offer', (d) => String(d?.rideRequestId) === rideRequestId, 6000)
      .then(() => ({ got: true }))
      .catch(() => ({ got: false }));

    driverSocket.emit('driver_response', { rideRequestId, driverId: driver.user._id, action: 'accept' });

    const driverErr = await driverErrP;
    const riderOffer = await riderOfferP;

    console.log('Driver error:', driverErr);
    if (riderOffer.got) {
      throw new Error('BUG: Rider received fare_offer even though driver is below minimum wallet');
    }

    console.log('\n✅ PASS: accept blocked and no fare_offer sent to rider.\n');
  } finally {
    try { riderSocket?.disconnect(); } catch {}
    try { driverSocket?.disconnect(); } catch {}
    // give sockets time to close
    await sleep(200);
  }
}

run().catch((e) => {
  console.error('\n❌ FAIL:', e?.message || e);
  process.exitCode = 1;
});

