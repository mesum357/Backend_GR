/**
 * GB RIDES — E2E sanity: socket event dedupe + low-network resilience helpers
 *
 * What this script validates (server-side / transport-side):
 * - Sending rider_arrived / start_ride / end_ride multiple times with the SAME eventId
 *   should only produce ONE downstream event for the other party:
 *   - driver gets "rider_at_pickup" once
 *   - rider gets "ride_started" once
 *   - both get "ride_completed" once
 *
 * Why this is useful for the reported "notification flooding":
 * - If a client accidentally re-sends the same critical socket event, the server should not
 *   fan out duplicates. This reduces downstream UI/notification spam.
 *
 * Usage (local):
 *   cd Backend_GR
 *   # ensure server is running (npm run dev) and Mongo is up
 *   # disable OTP requirements for tests:
 *   #   RIDER_WHATSAPP_OTP_REQUIRED=0
 *   #   DRIVER_WHATSAPP_OTP_REQUIRED=0
 *   node test-fixes-event-dedupe.js
 *
 * Remote:
 *   API_URL="https://..." node test-fixes-event-dedupe.js
 */

const fetch = require('node-fetch').default;
const io = require('socket.io-client');

const LOCAL_PORT = process.env.LOCAL_API_PORT || '8080';
const LOCAL_DEFAULT = `http://127.0.0.1:${LOCAL_PORT}`;
const BASE_URL = (process.env.API_URL || process.env.BASE_URL || LOCAL_DEFAULT).replace(/\/$/, '');
// Default password only used if you run in "register" mode.
const PASSWORD = 'TestPass123!';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(msg) {
  console.log(msg);
}

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
      try {
        data = await res.json();
      } catch {
        data = {};
      }
      return { ok: res.ok, status: res.status, data, url, method };
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
      const isConnRefused = msg.includes('ECONNREFUSED') || msg.includes('socket hang up');
      if (!isConnRefused || attempt === maxAttempts) {
        throw e;
      }
      await sleep(350 * attempt);
    }
  }
  // unreachable
  return { ok: false, status: 0, data: {}, url, method };
}

function connectSocket(label) {
  return new Promise((resolve, reject) => {
    const s = io(BASE_URL, { transports: ['polling', 'websocket'], timeout: 15000, forceNew: true, reconnection: false });
    const t = setTimeout(() => reject(new Error(`${label} socket timeout`)), 15000);
    s.on('connect', () => {
      clearTimeout(t);
      resolve(s);
    });
    s.on('connect_error', (e) => {
      clearTimeout(t);
      reject(new Error(`${label} socket connect_error: ${e.message}`));
    });
  });
}

function waitForCount(socket, event, ms) {
  let count = 0;
  const handler = () => {
    count += 1;
  };
  socket.on(event, handler);
  return new Promise((resolve) => {
    setTimeout(() => {
      socket.off(event, handler);
      resolve(count);
    }, ms);
  });
}

async function registerAndLogin(userType) {
  // This backend enforces email OTP by default. For automated E2E, disable it:
  //   EMAIL_VERIFICATION_REQUIRED=0
  // If you want to keep OTP on, you must provide a real 6-digit code via TEST_EMAIL_OTP
  // after using the send-code endpoint (this script can request the email, but cannot read it).
  const emailOtpRequired = process.env.EMAIL_VERIFICATION_REQUIRED !== '0';

  const rand = Math.random().toString(16).slice(2, 8);
  const email = `e2e_${userType}_${Date.now()}_${rand}@test.dev`;
  const phone = `+92${String(Math.floor(1000000000 + Math.random() * 8999999999))}`;

  const otp = String(process.env.TEST_EMAIL_OTP || '').trim();
  if (emailOtpRequired) {
    // Best-effort: request the email (still requires you to read it and set TEST_EMAIL_OTP).
    const sendPath = userType === 'driver' ? '/api/auth/driver/email/send-code' : '/api/auth/rider/email/send-code';
    await http('POST', sendPath, null, { email });
    if (!/^\d{6}$/.test(otp)) {
      throw new Error(
        `Email OTP is required by server. Re-run with EMAIL_VERIFICATION_REQUIRED=0 for automated tests, ` +
          `or set TEST_EMAIL_OTP to the 6-digit code sent to ${email}.`
      );
    }
  }

  const regBody = {
    firstName: userType === 'driver' ? 'E2E' : 'E2E',
    lastName: userType === 'driver' ? 'Driver' : 'Rider',
    email,
    phone,
    password: PASSWORD,
    userType,
    ...(emailOtpRequired ? { emailVerificationCode: otp } : {}),
  };

  const reg = await http('POST', '/api/auth/register', null, regBody);
  if (!reg.ok) {
    throw new Error(`Register ${userType} failed: ${reg.status} ${JSON.stringify(reg.data).slice(0, 200)}`);
  }

  const login = await http('POST', '/api/auth/login', null, { email, password: PASSWORD, userType });
  if (!login.ok || !login.data?.token || !login.data?.user?._id) {
    throw new Error(`Login ${userType} failed: ${login.status} ${JSON.stringify(login.data).slice(0, 200)}`);
  }
  return { token: login.data.token, userId: login.data.user._id, email };
}

async function loginExistingUser(userType, email, password) {
  // Backend expects `expectedUserType` for login.
  const login = await http('POST', '/api/auth/login', null, { email, password, expectedUserType: userType });
  if (!login.ok || !login.data?.token || !login.data?.user?._id) {
    throw new Error(
      `Login ${userType} failed for ${email}: ${login.status} ${JSON.stringify(login.data).slice(0, 200)}`
    );
  }
  const token = login.data.token;
  const userId = login.data.user._id;

  // Important: driver realtime + ride_request assignment uses DRIVER PROFILE _id in many places.
  // So we fetch /api/drivers/profile to get a stable id for sockets + ride lifecycle emits.
  if (userType === 'driver') {
    const prof = await http('GET', '/api/drivers/profile', token, null);
    if (!prof.ok || !prof.data?.driver?.id) {
      throw new Error(
        `Fetch driver profile failed for ${email}: ${prof.status} ${JSON.stringify(prof.data).slice(0, 200)}`
      );
    }
    const driverProfileId = prof.data.driver.id;
    return { token, userId, email, driverProfileId, socketAuthId: driverProfileId };
  }

  return { token, userId, email, socketAuthId: userId };
}

async function main() {
  log(`BASE_URL = ${BASE_URL}`);

  // --- Setup users
  log('\n== Setup users ==');
  const useExisting =
    process.env.USE_EXISTING_TEST_USERS === '1' ||
    process.env.USE_EXISTING_TEST_USERS === 'true';
  log(`Using existing test users: ${useExisting ? 'YES' : 'NO (will register new users)'}`);

  const riderEmail = process.env.RIDER_EMAIL || 'seimughal@gmail.com';
  const riderPass = process.env.RIDER_PASSWORD || '123456';
  const driverEmail = process.env.DRIVER_EMAIL || 'junaid@gmail.com';
  const driverPass = process.env.DRIVER_PASSWORD || '123456';

  const rider = useExisting
    ? await loginExistingUser('rider', riderEmail, riderPass)
    : await registerAndLogin('rider');

  const driver = useExisting
    ? await loginExistingUser('driver', driverEmail, driverPass)
    : await registerAndLogin('driver');
  log(`Rider userId: ${rider.userId}`);
  log(`Driver userId: ${driver.userId}`);
  if (driver.driverProfileId) log(`Driver profileId: ${driver.driverProfileId}`);

  // --- Connect sockets
  log('\n== Connect sockets ==');
  const riderSocket = await connectSocket('Rider');
  const driverSocket = await connectSocket('Driver');
  riderSocket.emit('authenticate', { userId: rider.socketAuthId, userType: 'rider' });
  driverSocket.emit('authenticate', { userId: driver.socketAuthId, userType: 'driver' });

  // --- Create ride request (rider)
  log('\n== Create ride request ==');
  const pickup = { latitude: 35.9208, longitude: 74.3083, address: 'Pickup (E2E)' };
  const dest = { latitude: 35.918, longitude: 74.32, address: 'Destination (E2E)' };
  const create = await http('POST', '/api/ride-requests/create', rider.token, {
    pickupLocation: pickup,
    destination: dest,
    requestedPrice: 200,
    paymentMethod: 'cash',
    vehicleType: 'any',
    notes: 'e2e dedupe test',
  });
  if (!create.ok) throw new Error(`Create ride request failed: ${create.status} ${JSON.stringify(create.data).slice(0, 200)}`);
  const rideRequestId =
    create.data?.rideRequestId ||
    create.data?.rideRequest?._id ||
    create.data?.rideRequest?.id ||
    create.data?.rideRequest?.rideRequestId ||
    create.data?._id;
  if (!rideRequestId) throw new Error(`Could not extract rideRequestId from: ${JSON.stringify(create.data).slice(0, 250)}`);
  log(`rideRequestId = ${rideRequestId}`);

  // --- Driver accepts ride request (REST)
  log('\n== Driver accepts ==');
  // Give the server a moment to attach availableDrivers
  await sleep(400);
  const accept = await http('POST', `/api/ride-requests/${rideRequestId}/respond`, driver.token, { action: 'accept' });
  if (!accept.ok) throw new Error(`Driver accept failed: ${accept.status} ${JSON.stringify(accept.data).slice(0, 200)}`);

  // Ensure the ride request has an acceptedBy value before we test rider_arrived fan-out.
  let acceptedBy = accept.data?.rideRequest?.acceptedBy || accept.data?.acceptedBy || null;
  for (let i = 0; i < 6 && !acceptedBy; i++) {
    await sleep(250);
    const st = await http('GET', `/api/ride-requests/${rideRequestId}/status`, rider.token, null);
    acceptedBy = st.data?.rideRequest?.acceptedBy || st.data?.acceptedBy || null;
  }
  log(`acceptedBy = ${acceptedBy || 'null'}`);

  // --- Dedupe tests
  let pickupCount = null;
  if (!acceptedBy) {
    log('\n== Dedupe: rider_arrived -> driver rider_at_pickup (SKIP: ride not assigned) ==');
    log('Skipping rider_arrived test because acceptedBy is null (no assigned driver to notify).');
  } else {
    log('\n== Dedupe: rider_arrived -> driver rider_at_pickup (expect 1) ==');
    const arrivedEventId = `e2e_arrived_${Date.now()}`;
    const pickupCountP = waitForCount(driverSocket, 'rider_at_pickup', 1500);
    riderSocket.emit('rider_arrived', { rideRequestId, riderId: rider.userId, eventId: arrivedEventId, latitude: pickup.latitude, longitude: pickup.longitude });
    riderSocket.emit('rider_arrived', { rideRequestId, riderId: rider.userId, eventId: arrivedEventId, latitude: pickup.latitude, longitude: pickup.longitude });
    riderSocket.emit('rider_arrived', { rideRequestId, riderId: rider.userId, eventId: arrivedEventId, latitude: pickup.latitude, longitude: pickup.longitude });
    pickupCount = await pickupCountP;
    log(`driver rider_at_pickup events: ${pickupCount}`);
  }

  log('\n== Dedupe: start_ride -> rider ride_started (expect 1) ==');
  const startEventId = `e2e_start_${Date.now()}`;
  const startedCountP = waitForCount(riderSocket, 'ride_started', 1500);
  driverSocket.emit('start_ride', { rideRequestId, driverId: driver.socketAuthId, eventId: startEventId });
  driverSocket.emit('start_ride', { rideRequestId, driverId: driver.socketAuthId, eventId: startEventId });
  driverSocket.emit('start_ride', { rideRequestId, driverId: driver.socketAuthId, eventId: startEventId });
  const startedCount = await startedCountP;
  log(`rider ride_started events: ${startedCount}`);

  log('\n== Dedupe: end_ride -> both ride_completed (expect 1 each) ==');
  const endEventId = `e2e_end_${Date.now()}`;
  const compRiderP = waitForCount(riderSocket, 'ride_completed', 2500);
  const compDriverP = waitForCount(driverSocket, 'ride_completed', 2500);
  driverSocket.emit('end_ride', { rideRequestId, driverId: driver.socketAuthId, eventId: endEventId });
  driverSocket.emit('end_ride', { rideRequestId, driverId: driver.socketAuthId, eventId: endEventId });
  driverSocket.emit('end_ride', { rideRequestId, driverId: driver.socketAuthId, eventId: endEventId });
  const compRider = await compRiderP;
  const compDriver = await compDriverP;
  log(`rider ride_completed events: ${compRider}`);
  log(`driver ride_completed events: ${compDriver}`);

  // --- Results summary
  log('\n== Summary ==');
  const ok1 = pickupCount == null ? null : pickupCount === 1;
  const ok2 = startedCount === 1;
  const ok3 = compRider === 1 && compDriver === 1;
  log(`rider_arrived dedupe: ${ok1 == null ? 'SKIP' : ok1 ? 'OK' : 'FAIL'}`);
  log(`start_ride dedupe: ${ok2 ? 'OK' : 'FAIL'}`);
  log(`end_ride dedupe: ${ok3 ? 'OK' : 'FAIL'}`);

  riderSocket.disconnect();
  driverSocket.disconnect();

  if ((ok1 === false) || !ok2 || !ok3) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('E2E script failed:', e);
  process.exitCode = 1;
});

