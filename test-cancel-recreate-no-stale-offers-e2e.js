#!/usr/bin/env node
/**
 * E2E regression suite for common ride-making bugs:
 *
 * 1) cancel -> recreate must generate a NEW rideRequestId and driver must receive ride_request.
 * 2) offer timeout should NOT cancel rideRequest server-side; status must remain searching/pending.
 *
 * Note: UI redirect/homepage issues are frontend-only; we validate the underlying API/socket
 * invariants that prevent stale state (new request ids, offers, and request status).
 */
const fetch = require('node-fetch').default;
const io = require('socket.io-client');

const LOCAL_PORT = process.env.LOCAL_API_PORT || '8080';
const BASE_URL = (process.env.API_URL || `http://127.0.0.1:${LOCAL_PORT}`).replace(/\/$/, '');
const PASSWORD = process.env.PASSWORD || 'password123';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@gbrides.pk';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin12345';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, url, token, body) {
  const headers = { Accept: 'application/json' };
  if (body != null) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const res = await fetch(url, { method, headers, signal: controller.signal, ...(body != null ? { body: JSON.stringify(body) } : {}) })
    .finally(() => clearTimeout(timeout));
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
    rider: { email: `nr_rider_${ts}@example.com`, phone: `7${String(ts).slice(-9)}` },
    driver: { email: `nr_driver_${ts}@example.com`, phone: `6${String(ts).slice(-9)}` },
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
  console.log(`\nCancel/Recreate + timeout invariants @ ${BASE_URL}\n`);

  const ts = Date.now();
  const u = users(ts);
  const PICKUP = { latitude: 35.9208, longitude: 74.3144, address: 'Gilgit City Center' };
  const DEST = { latitude: 35.935, longitude: 74.33, address: 'Jutial, Gilgit' };

  let riderSocket;
  let driverSocket;

  await registerUser({ ...u.rider, userType: 'rider', firstName: 'Rider', lastName: 'NR' });
  await registerUser({ ...u.driver, userType: 'driver', firstName: 'Driver', lastName: 'NR', plate: `NR${String(ts).slice(-4)}` });

  const adminToken = await adminLogin();
  await setMinimumDriverWallet(adminToken, 0);
  await approveDriverByEmail(adminToken, u.driver.email);

  const rider = await login(u.rider.email, 'rider');
  const driver = await login(u.driver.email, 'driver');

  riderSocket = await connectSocket('rider');
  driverSocket = await connectSocket('driver');
  riderSocket.emit('authenticate', { userId: rider.user._id, userType: 'rider' });
  driverSocket.emit('authenticate', { userId: driver.user._id, userType: 'driver' });

  await http('POST', `${BASE_URL}/api/drivers/toggle-status`, driver.token, {});
  await http('POST', `${BASE_URL}/api/drivers/location`, driver.token, {
    latitude: PICKUP.latitude + 0.001,
    longitude: PICKUP.longitude + 0.001,
  });

  // 1) Create request #1 and ensure driver receives it.
  const req1EventP = waitEvent(driverSocket, 'ride_request', null, 15000);
  const req1 = await http('POST', `${BASE_URL}/api/ride-requests/request-ride`, rider.token, {
    pickup: PICKUP, destination: DEST, offeredFare: 200, radiusMeters: 5000, paymentMethod: 'cash', vehicleType: 'any', notes: 'nr-1',
  });
  const ride1 = String(req1.data?.rideRequest?.id || '');
  if (!(req1.status === 201 && ride1)) throw new Error(`create req1 failed: ${JSON.stringify(req1.data)}`);
  const evt1 = await req1EventP;
  if (String(evt1?.rideRequestId || '') !== ride1) throw new Error(`driver didn't get req1 id: ${JSON.stringify(evt1)}`);
  console.log('✓ Driver received ride_request #1');

  // Driver accepts (offer) via REST, rider receives offer.
  const offerP = waitEvent(riderSocket, 'fare_offer', (d) => String(d?.rideRequestId) === ride1, 15000);
  const acceptRes = await http('POST', `${BASE_URL}/api/ride-requests/${ride1}/respond`, driver.token, { action: 'accept' });
  if (!acceptRes.ok) throw new Error(`driver accept failed: ${JSON.stringify(acceptRes.data)}`);
  await offerP;
  console.log('✓ Rider received fare_offer for req1');

  // Wait 16s without rider response; server should NOT cancel the request automatically.
  await sleep(16000);
  const st = await http('GET', `${BASE_URL}/api/ride-requests/${ride1}/status`, rider.token);
  const status = st.data?.rideRequest?.status || st.data?.status;
  if (status === 'cancelled' || status === 'completed') {
    throw new Error(`unexpected status after offer timeout window: ${status}`);
  }
  console.log(`✓ RideRequest status after 16s is still '${status}' (not cancelled)`);

  // Rider cancels explicitly.
  const cancelRes = await http('POST', `${BASE_URL}/api/ride-requests/${ride1}/cancel`, rider.token, {});
  if (!cancelRes.ok) throw new Error(`cancel req1 failed: ${JSON.stringify(cancelRes.data)}`);
  console.log('✓ Rider cancelled req1');

  // 2) Create request #2 and ensure driver receives new id.
  const req2EventP = waitEvent(driverSocket, 'ride_request', null, 15000);
  const req2 = await http('POST', `${BASE_URL}/api/ride-requests/request-ride`, rider.token, {
    pickup: PICKUP, destination: DEST, offeredFare: 220, radiusMeters: 5000, paymentMethod: 'cash', vehicleType: 'any', notes: 'nr-2',
  });
  const ride2 = String(req2.data?.rideRequest?.id || '');
  if (!(req2.status === 201 && ride2 && ride2 !== ride1)) throw new Error(`create req2 failed: ${JSON.stringify(req2.data)}`);
  const evt2 = await req2EventP;
  if (String(evt2?.rideRequestId || '') !== ride2) throw new Error(`driver didn't get req2 id: ${JSON.stringify(evt2)}`);
  console.log('✓ Driver received ride_request #2 (new id)');

  console.log('\n✅ PASS\n');

  try { riderSocket?.disconnect(); } catch {}
  try { driverSocket?.disconnect(); } catch {}
}

run().catch((e) => {
  console.error('\n❌ FAIL:', e?.message || e);
  process.exitCode = 1;
});

