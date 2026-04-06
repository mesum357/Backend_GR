/**
 * GB RIDES — E2E: Driver requests visibility under low internet
 *
 * Goal:
 * - Simulate a driver missing realtime socket events (poor network / reconnect)
 * - Verify the driver can still retrieve ride requests via polling endpoints:
 *     GET /api/ride-requests/available-simple
 *     GET /api/ride-requests/available?latitude=...&longitude=...&radius=...
 *
 * Usage:
 *   cd Backend_GR
 *   # ensure server is running (npm run dev)
 *   USE_EXISTING_TEST_USERS=1 RIDER_EMAIL=... RIDER_PASSWORD=... DRIVER_EMAIL=... DRIVER_PASSWORD=... node test-low-network-driver-requests.js
 *
 * Notes:
 * - This script does NOT test the mobile UI directly.
 * - It validates the backend data path the driver app relies on when sockets are flaky.
 */

const fetch = require('node-fetch').default;
const io = require('socket.io-client');

const LOCAL_PORT = process.env.LOCAL_API_PORT || '8080';
const LOCAL_DEFAULT = `http://127.0.0.1:${LOCAL_PORT}`;
const BASE_URL = (process.env.API_URL || process.env.BASE_URL || LOCAL_DEFAULT).replace(/\/$/, '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(method, path, token, body) {
  const url = `${BASE_URL}${path}`;
  const headers = { Accept: 'application/json' };
  if (body != null) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { method, headers, body: body != null ? JSON.stringify(body) : undefined });
      let data;
      try { data = await res.json(); } catch { data = {}; }
      return { ok: res.ok, status: res.status, data, url };
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
      const isConnRefused = msg.includes('ECONNREFUSED') || msg.includes('socket hang up');
      if (!isConnRefused || attempt === maxAttempts) throw e;
      await sleep(350 * attempt);
    }
  }
  return { ok: false, status: 0, data: {}, url };
}

async function loginExistingUser(userType, email, password) {
  const login = await http('POST', '/api/auth/login', null, { email, password, expectedUserType: userType });
  if (!login.ok || !login.data?.token || !login.data?.user?._id) {
    throw new Error(`Login ${userType} failed for ${email}: ${login.status} ${JSON.stringify(login.data).slice(0, 200)}`);
  }
  const token = login.data.token;
  const userId = login.data.user._id;

  if (userType === 'driver') {
    const prof = await http('GET', '/api/drivers/profile', token, null);
    if (!prof.ok || !prof.data?.driver?.id) {
      throw new Error(`Fetch driver profile failed: ${prof.status} ${JSON.stringify(prof.data).slice(0, 200)}`);
    }
    return { token, userId, driverProfileId: prof.data.driver.id };
  }
  return { token, userId };
}

function connectSocket(label) {
  return new Promise((resolve, reject) => {
    const s = io(BASE_URL, { transports: ['polling', 'websocket'], timeout: 15000, forceNew: true, reconnection: false });
    const t = setTimeout(() => reject(new Error(`${label} socket timeout`)), 15000);
    s.on('connect', () => { clearTimeout(t); resolve(s); });
    s.on('connect_error', (e) => { clearTimeout(t); reject(new Error(`${label} socket connect_error: ${e.message}`)); });
  });
}

function extractRequestsList(json) {
  const raw = json?.rideRequests ?? json?.requests ?? (Array.isArray(json) ? json : null);
  return Array.isArray(raw) ? raw : [];
}

async function main() {
  console.log(`BASE_URL = ${BASE_URL}`);
  if (!(process.env.USE_EXISTING_TEST_USERS === '1' || process.env.USE_EXISTING_TEST_USERS === 'true')) {
    throw new Error('Set USE_EXISTING_TEST_USERS=1 and provide RIDER_EMAIL/RIDER_PASSWORD/DRIVER_EMAIL/DRIVER_PASSWORD');
  }

  const riderEmail = process.env.RIDER_EMAIL || '';
  const riderPass = process.env.RIDER_PASSWORD || '';
  const driverEmail = process.env.DRIVER_EMAIL || '';
  const driverPass = process.env.DRIVER_PASSWORD || '';
  if (!riderEmail || !riderPass || !driverEmail || !driverPass) {
    throw new Error('Missing RIDER_EMAIL/RIDER_PASSWORD/DRIVER_EMAIL/DRIVER_PASSWORD env vars');
  }

  console.log('\n== Login users ==');
  const rider = await loginExistingUser('rider', riderEmail, riderPass);
  const driver = await loginExistingUser('driver', driverEmail, driverPass);
  console.log(`Rider userId: ${rider.userId}`);
  console.log(`Driver userId: ${driver.userId}`);
  console.log(`Driver profileId: ${driver.driverProfileId}`);

  // Step 1: driver is "offline" (no socket) to simulate missed realtime.
  console.log('\n== Create ride request while driver is offline (miss socket) ==');
  const pickupLocation = { latitude: 35.9208, longitude: 74.3083, address: 'Pickup (LowNet)' };
  const destination = { latitude: 35.918, longitude: 74.32, address: 'Destination (LowNet)' };
  const created = await http('POST', '/api/ride-requests/create', rider.token, {
    pickupLocation,
    destination,
    requestedPrice: 210,
    paymentMethod: 'cash',
    vehicleType: 'any',
    notes: `lownet_${Date.now()}`,
  });
  if (!created.ok) throw new Error(`Create ride request failed: ${created.status} ${JSON.stringify(created.data).slice(0, 200)}`);
  const rideRequestId = created.data?.rideRequest?.id || created.data?.rideRequestId || created.data?.rideRequest?._id;
  if (!rideRequestId) throw new Error(`Could not read rideRequestId: ${JSON.stringify(created.data).slice(0, 220)}`);
  console.log(`rideRequestId = ${rideRequestId}`);

  // Step 2: driver "reconnects" (socket comes back) and should rehydrate via polling.
  console.log('\n== Driver reconnects (socket) ==');
  const driverSocket = await connectSocket('Driver');
  driverSocket.emit('authenticate', { userId: driver.driverProfileId, userType: 'driver' });

  // Step 2b: Set driver location near pickup (so geo-filtered /available can include it).
  console.log('\n== Driver sets location (near pickup) ==');
  const loc = await http('POST', '/api/drivers/location', driver.token, {
    latitude: pickupLocation.latitude,
    longitude: pickupLocation.longitude,
  });
  console.log(`POST /api/drivers/location -> ${loc.status}`);

  // Step 3: poll endpoints to ensure request is visible.
  console.log('\n== Driver polling: available-simple ==');
  let foundSimple = false;
  for (let i = 0; i < 8; i++) {
    const res = await http('GET', '/api/ride-requests/available-simple', driver.token, null);
    if (!res.ok) {
      console.log(`available-simple HTTP ${res.status}`);
      await sleep(250);
      continue;
    }
    const list = extractRequestsList(res.data);
    foundSimple = list.some((r) => String(r.id || r._id || '') === String(rideRequestId));
    console.log(`attempt ${i + 1}: list=${list.length} found=${foundSimple}`);
    if (foundSimple) break;
    await sleep(300);
  }

  console.log('\n== Driver polling fallback: available (lat/lon) ==');
  let foundNearby = false;
  for (let i = 0; i < 6; i++) {
    const res = await http(
      'GET',
      `/api/ride-requests/available?latitude=${pickupLocation.latitude}&longitude=${pickupLocation.longitude}&radius=5`,
      driver.token,
      null
    );
    if (!res.ok) {
      console.log(`available HTTP ${res.status}`);
      await sleep(250);
      continue;
    }
    const list = extractRequestsList(res.data);
    foundNearby = list.some((r) => String(r.id || r._id || '') === String(rideRequestId));
    console.log(`attempt ${i + 1}: list=${list.length} found=${foundNearby}`);
    if (foundNearby) break;
    await sleep(350);
  }

  driverSocket.disconnect();

  console.log('\n== Summary ==');
  console.log(`Visible via available-simple: ${foundSimple ? 'YES' : 'NO'}`);
  console.log(`Visible via available fallback: ${foundNearby ? 'YES' : 'NO'}`);

  if (!foundSimple && !foundNearby) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('LowNet script failed:', e);
  process.exitCode = 1;
});

