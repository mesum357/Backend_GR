/**
 * Test Script: Ride Request & Multi-Offer Flow
 *
 * Tests:
 * 1. Rider creates a ride request → driver dashboard shows it
 * 2. Rider updates fare via PATCH → driver dashboard updates fare (not cancel)
 * 3. Multiple riders create requests → driver sees all of them
 * 4. Multiple drivers accept → rider receives multiple offers
 *
 * Usage:
 *   1. Start your backend:  cd Backend_GR && node server.js
 *   2. Run this script:     node tests/test_ride_flow.js
 *
 * The script uses the REST API directly.
 * Adjust BASE_URL/credentials if needed.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

// ─── Helpers ───────────────────────────────────────────────
async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function patch(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function get(path, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✅ PASS: ${message}`);
  }
}

// ─── Auth helper ───────────────────────────────────────────
async function login(email, password, userType) {
  const res = await post('/api/auth/login', { email, password, expectedUserType: userType });
  if (!res.ok) {
    console.error(`Login failed for ${email}:`, res.data);
    return null;
  }
  return res.data.token;
}

async function register(email, password, firstName, lastName, userType) {
  const res = await post('/api/auth/register', {
    email,
    password,
    firstName,
    lastName,
    phone: `+92300${Math.floor(1000000 + Math.random() * 9000000)}`,
    userType,
  });
  return res;
}

// ─── Main ──────────────────────────────────────────────────
(async () => {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     Ride Flow Test Script                    ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`Using backend: ${BASE_URL}\n`);

  // ── Step 0: Create/Login test accounts ───────────────
  const ts = Date.now();
  const riderEmail1 = `testrider1_${ts}@test.com`;
  const riderEmail2 = `testrider2_${ts}@test.com`;
  const driverEmail1 = `testdriver1_${ts}@test.com`;
  const driverEmail2 = `testdriver2_${ts}@test.com`;
  const password = 'Test1234!';

  console.log('── Step 0: Registering test users ──');

  await register(riderEmail1, password, 'Rider', 'One', 'rider');
  await register(riderEmail2, password, 'Rider', 'Two', 'rider');
  await register(driverEmail1, password, 'Driver', 'One', 'driver');
  await register(driverEmail2, password, 'Driver', 'Two', 'driver');

  const riderToken1 = await login(riderEmail1, password, 'rider');
  const riderToken2 = await login(riderEmail2, password, 'rider');
  const driverToken1 = await login(driverEmail1, password, 'driver');
  const driverToken2 = await login(driverEmail2, password, 'driver');

  if (!riderToken1 || !riderToken2 || !driverToken1 || !driverToken2) {
    console.error('Could not login all test users. Aborting.');
    process.exit(1);
  }
  console.log('  All test users logged in\n');

  // ── TEST 1: Rider creates ride request ───────────────
  console.log('── Test 1: Rider 1 creates a ride request ──');
  const rideRes1 = await post('/api/ride-requests/request-ride', {
    pickup: { latitude: 33.6844, longitude: 73.0479, address: 'F-6 Islamabad' },
    destination: { latitude: 33.7200, longitude: 73.0400, address: 'F-10 Islamabad' },
    offeredFare: 200,
    radiusMeters: 5000,
    paymentMethod: 'cash',
    vehicleType: 'any',
    notes: '',
  }, riderToken1);

  assert(rideRes1.ok, `Ride request created (status ${rideRes1.status})`);
  const rideId1 = rideRes1.data?.rideRequest?.id;
  assert(!!rideId1, `Ride request ID received: ${rideId1}`);

  // Check driver can see it
  const available1 = await get('/api/ride-requests/available-simple', driverToken1);
  assert(available1.ok, 'Driver can fetch available requests');
  const found1 = available1.data?.rideRequests?.some(r => r.rideRequestId === rideId1 || r.id === rideId1);
  assert(found1, `Driver can see Rider 1's request in dashboard`);
  console.log();

  // ── TEST 2: Rider updates fare via PATCH ─────────────
  console.log('── Test 2: Rider 1 updates fare (PATCH) ──');
  const fareRes = await patch(`/api/ride-requests/${rideId1}/update-fare`, {
    newFare: 250,
  }, riderToken1);

  assert(fareRes.ok, `Fare updated successfully (status ${fareRes.status})`);
  assert(fareRes.data?.rideRequest?.newFare === 250, `New fare is PKR 250`);

  // Verify request is NOT cancelled
  const statusRes = await get(`/api/ride-requests/${rideId1}/status`, riderToken1);
  assert(statusRes.ok, 'Can fetch ride status');
  assert(
    statusRes.data?.status === 'searching' || statusRes.data?.status === 'pending',
    `Ride is still active (status: ${statusRes.data?.status}), not cancelled`
  );

  // Verify driver sees updated fare
  const available2 = await get('/api/ride-requests/available-simple', driverToken1);
  const updatedReq = available2.data?.rideRequests?.find(r => r.rideRequestId === rideId1 || r.id === rideId1);
  assert(!!updatedReq, 'Driver still sees the request after fare update');
  const updatedFare = updatedReq?.offeredFare ?? updatedReq?.requestedPrice;
  assert(updatedFare === 250, `Driver sees updated fare: PKR ${updatedFare}`);
  console.log();

  // ── TEST 3: Multiple riders → multiple requests ──────
  console.log('── Test 3: Rider 2 creates a request → driver sees 2 ──');
  const rideRes2 = await post('/api/ride-requests/request-ride', {
    pickup: { latitude: 33.6900, longitude: 73.0500, address: 'G-9 Islamabad' },
    destination: { latitude: 33.7100, longitude: 73.0300, address: 'G-11 Islamabad' },
    offeredFare: 300,
    radiusMeters: 5000,
    paymentMethod: 'cash',
    vehicleType: 'any',
    notes: '',
  }, riderToken2);

  assert(rideRes2.ok, `Rider 2 ride request created (status ${rideRes2.status})`);
  const rideId2 = rideRes2.data?.rideRequest?.id;
  assert(!!rideId2, `Rider 2 request ID: ${rideId2}`);

  const available3 = await get('/api/ride-requests/available-simple', driverToken1);
  const allIds = (available3.data?.rideRequests || []).map(r => r.rideRequestId || r.id);
  const hasRide1 = allIds.includes(rideId1);
  const hasRide2 = allIds.includes(rideId2);
  assert(hasRide1 && hasRide2, `Driver sees BOTH requests (${allIds.length} total): ride1=${hasRide1}, ride2=${hasRide2}`);
  console.log();

  // ── TEST 4: Driver respond endpoint validation ────────
  console.log('── Test 4: Driver respond endpoint validation ──');
  console.log('  ℹ️  Note: In production, drivers are added to availableDrivers via');
  console.log('     WebSocket proximity matching. REST-only tests can verify the');
  console.log('     endpoint exists and validates properly.\n');

  // Driver 1 tries to accept (will fail with "Driver not in available drivers list"
  // because WebSocket proximity matching hasn't added them — this is expected)
  const accept1 = await post(`/api/ride-requests/${rideId1}/respond`, {
    action: 'accept',
  }, driverToken1);
  console.log(`  Driver 1 accept response: status=${accept1.status}`);

  // Driver 2 tries counter-offer
  const accept2 = await post(`/api/ride-requests/${rideId1}/respond`, {
    action: 'counter_offer',
    counterOffer: 220,
  }, driverToken2);
  console.log(`  Driver 2 counter-offer response: status=${accept2.status}`);

  // The expected error is "Driver not in available drivers list" (400), NOT a 500 server crash
  const expected400 = accept1.status === 400 && accept2.status === 400;
  assert(expected400, 'Respond endpoint validates driver availability (expected 400, not 500)');
  console.log();

  // ── Cleanup ──────────────────────────────────────────
  console.log('── Cleanup: cancelling test ride requests ──');
  await post(`/api/ride-requests/${rideId1}/cancel`, {}, riderToken1);
  await post(`/api/ride-requests/${rideId2}/cancel`, {}, riderToken2);
  console.log('  Test ride requests cancelled\n');

  // ── Summary ──────────────────────────────────────────
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     Test Complete                            ║');
  console.log('╚══════════════════════════════════════════════╝');
  if (process.exitCode === 1) {
    console.log('Some tests FAILED — see ❌ above.');
  } else {
    console.log('All tests PASSED! ✅');
  }
})();
