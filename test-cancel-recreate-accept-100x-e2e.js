#!/usr/bin/env node
/**
 * Stress E2E (x100):
 * - Rider creates ride request
 * - Driver receives it and sends accept via socket (driver_response)
 * - Rider cancels
 * - Rider creates again
 * - Driver accepts again
 *
 * Goal: catch race/stale-state issues where 2nd request cannot be acted upon.
 */
const fetch = require('node-fetch').default;
const io = require('socket.io-client');

const LOCAL_PORT = process.env.LOCAL_API_PORT || '8080';
const LOCAL_DEFAULT = `http://127.0.0.1:${LOCAL_PORT}`;
const USE_LOCAL_ONLY = process.env.LOCAL_ONLY === '1' || process.env.LOCAL_ONLY === 'true';
const BASE_URL = (USE_LOCAL_ONLY ? LOCAL_DEFAULT : (process.env.API_URL || process.env.BASE_URL || LOCAL_DEFAULT)).replace(/\/$/, '');
const PASSWORD = 'password123';
const ITERATIONS = Number(process.env.ITERATIONS || 100);
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

function takeFromBuffer(buffer, match) {
  const idx = buffer.findIndex(match);
  if (idx >= 0) return buffer.splice(idx, 1)[0];
  return null;
}

async function waitBufferedOrEvent({ buffer, socket, event, match, timeoutMs }) {
  const existing = takeFromBuffer(buffer, match);
  if (existing) return existing;
  return await waitEvent(socket, event, match, timeoutMs);
}

function users(ts) {
  return {
    rider: { email: `sr_rider_${ts}@example.com`, phone: `7${String(ts).slice(-9)}` },
    driver: { email: `sr_driver_${ts}@example.com`, phone: `6${String(ts).slice(-9)}` },
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
  if (!r.ok) throw new Error(`register ${userType} failed (${r.status})`);
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

async function setMinimumDriverWallet(adminToken, value) {
  const r = await http('PATCH', `${BASE_URL}/api/admin/wallet/settings`, adminToken, { driverMinimumWalletPkr: value });
  if (!r.ok) throw new Error(`patch wallet settings failed (${r.status}) ${JSON.stringify(r.data?.error || r.data)}`);
  return r.data;
}

async function main() {
  console.log(`\nStress cancel/recreate/accept x${ITERATIONS} @ ${BASE_URL}\n`);

  const ts = Date.now();
  const u = users(ts);
  const PICKUP = { latitude: 35.9208, longitude: 74.3144, address: 'Gilgit City Center' };
  const DEST = { latitude: 35.935, longitude: 74.33, address: 'Jutial, Gilgit' };

  let riderSocket;
  let driverSocket;
  let passed = 0;
  let failed = 0;

  const fail = (label, err) => {
    failed++;
    console.log(`  [FAIL] ${label}${err ? ` — ${err}` : ''}`);
  };
  const pass = (label) => {
    passed++;
    // keep console quieter; only log occasional milestones
    if (passed % 10 === 0) console.log(`  [PASS] ${label} (passed=${passed})`);
  };

  try {
    console.log('Bootstrapping users + admin approval...');
    await registerUser({ ...u.rider, userType: 'rider', firstName: 'Rider', lastName: 'Stress' });
    await registerUser({ ...u.driver, userType: 'driver', firstName: 'Driver', lastName: 'Stress', plate: `SR${String(ts).slice(-4)}` });

    const rider = await login(u.rider.email, 'rider');
    // Newly registered drivers are blocked from login until admin approval.
    const adminToken = await adminLogin();
    // Ensure test driver isn't blocked by minimum wallet checks.
    await setMinimumDriverWallet(adminToken, 0);
    await approveDriverByEmail(adminToken, u.driver.email);
    const driver = await login(u.driver.email, 'driver');
    console.log('Bootstrap complete. Starting iterations...');

    riderSocket = await connectSocket('rider');
    driverSocket = await connectSocket('driver');
    riderSocket.emit('authenticate', { userId: rider.user._id, userType: 'rider' });
    driverSocket.emit('authenticate', { userId: driver.user._id, userType: 'driver' });

    // Buffers to avoid flakiness if events arrive before per-iteration waits.
    const driverRideRequests = [];
    const riderFareOffers = [];
    driverSocket.on('ride_request', (d) => driverRideRequests.push(d));
    riderSocket.on('fare_offer', (d) => riderFareOffers.push(d));

    // Ensure driver is online/available for matching.
    try {
      const profile = await http('GET', `${BASE_URL}/api/drivers/profile`, driver.token);
      if (!profile.ok) throw new Error('profile fetch failed');
      const isOnline = !!profile.data?.driver?.isOnline;
      if (!isOnline) {
        await http('POST', `${BASE_URL}/api/drivers/toggle-status`, driver.token, {});
      }
    } catch {
      // ignore
    }

    await http('POST', `${BASE_URL}/api/drivers/location`, driver.token, {
      latitude: PICKUP.latitude + 0.001,
      longitude: PICKUP.longitude + 0.001,
    });

    for (let i = 1; i <= ITERATIONS; i++) {
      if (i % 10 === 1) console.log(`Iteration ${i}/${ITERATIONS}...`);
      try {
        const iterationTimeoutMs = Number(process.env.ITERATION_TIMEOUT_MS || 45000);
        await Promise.race([
          (async () => {
            // create request #1
            const req1 = await http('POST', `${BASE_URL}/api/ride-requests/request-ride`, rider.token, {
              pickup: PICKUP,
              destination: DEST,
              offeredFare: 200 + i,
              radiusMeters: 5000,
              paymentMethod: 'cash',
              vehicleType: 'any',
              notes: `stress-1-${i}`,
            });
            const ride1 = String(req1.data?.rideRequest?.id || '');
            if (!(req1.status === 201 && ride1)) throw new Error(`create req1 failed: ${JSON.stringify(req1.data)}`);

            await waitBufferedOrEvent({
              buffer: driverRideRequests,
              socket: driverSocket,
              event: 'ride_request',
              match: (d) => String(d?.rideRequestId || '') === ride1,
              timeoutMs: 15000,
            });

            // driver accept via socket; rider should receive fare_offer
            driverSocket.emit('driver_response', { rideRequestId: ride1, driverId: driver.user._id, action: 'accept' });
            await waitBufferedOrEvent({
              buffer: riderFareOffers,
              socket: riderSocket,
              event: 'fare_offer',
              match: (d) => String(d?.rideRequestId) === ride1,
              timeoutMs: 15000,
            });

            // cancel #1
            const cancelEvtP = Promise.race([
              waitEvent(driverSocket, 'ride_request_cancelled', (d) => String(d?.rideRequestId) === ride1, 15000),
              waitEvent(driverSocket, 'ride_cancelled', (d) => String(d?.rideRequestId) === ride1, 15000),
            ]);
            const cancelRes = await http('POST', `${BASE_URL}/api/ride-requests/${ride1}/cancel`, rider.token, {});
            if (!cancelRes.ok) throw new Error(`cancel req1 failed: ${JSON.stringify(cancelRes.data)}`);
            await cancelEvtP;

            // create request #2
            const req2 = await http('POST', `${BASE_URL}/api/ride-requests/request-ride`, rider.token, {
              pickup: PICKUP,
              destination: DEST,
              offeredFare: 240 + i,
              radiusMeters: 5000,
              paymentMethod: 'cash',
              vehicleType: 'any',
              notes: `stress-2-${i}`,
            });
            const ride2 = String(req2.data?.rideRequest?.id || '');
            if (!(req2.status === 201 && ride2 && ride2 !== ride1)) throw new Error(`create req2 failed: ${JSON.stringify(req2.data)}`);

            await waitBufferedOrEvent({
              buffer: driverRideRequests,
              socket: driverSocket,
              event: 'ride_request',
              match: (d) => String(d?.rideRequestId || '') === ride2,
              timeoutMs: 15000,
            });

            // driver accept again; rider should receive fare_offer again
            driverSocket.emit('driver_response', { rideRequestId: ride2, driverId: driver.user._id, action: 'accept' });
            await waitBufferedOrEvent({
              buffer: riderFareOffers,
              socket: riderSocket,
              event: 'fare_offer',
              match: (d) => String(d?.rideRequestId) === ride2,
              timeoutMs: 15000,
            });

            // cleanup: cancel #2 so next loop is fresh
            await http('POST', `${BASE_URL}/api/ride-requests/${ride2}/cancel`, rider.token, {});
          })(),
          sleep(iterationTimeoutMs).then(() => { throw new Error(`iteration timeout after ${iterationTimeoutMs}ms`); }),
        ]);

        pass(`iter ${i}`);
        await sleep(250);
      } catch (e) {
        fail(`iter ${i}`, e?.message || String(e));
      }
    }
  } catch (e) {
    fail('Unhandled test error', e?.message || String(e));
  } finally {
    try { riderSocket?.disconnect(); } catch {}
    try { driverSocket?.disconnect(); } catch {}
  }

  console.log(`\nDone. Passed checks: ${passed}, Failed checks: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main();

