const fetch = require('node-fetch').default;
const fs = require('fs');
const path = require('path');

function resolveLocalBaseUrl() {
  try {
    const infoPath = path.join(__dirname, 'network-info.json');
    const content = fs.readFileSync(infoPath, 'utf8');
    const info = JSON.parse(content);
    if (info && info.url) return info.url;
  } catch (_) {}
  return 'http://127.0.0.1:8080';
}

const BASE_URL = resolveLocalBaseUrl();
console.log('🔗 Using BASE_URL:', BASE_URL);

async function testFreshDriverLocal() {
  try {
    console.log('🧪 Testing fresh driver flow (LOCAL)...');

    const timestamp = Date.now();
    const driverEmail = `localdriver${timestamp}@example.com`;
    const riderEmail = `localrider${timestamp}@example.com`;

    // Step 1: Register a new driver
    console.log('\n1. Registering new driver...');
    const driverRegisterResponse = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        firstName: 'Local',
        lastName: 'Driver',
        email: driverEmail,
        phone: `92${timestamp.toString().slice(-10)}`,
        password: 'password123',
        userType: 'driver'
      })
    });

    const driverRegisterData = await driverRegisterResponse.json();
    console.log('✅ Driver registration response:', driverRegisterData);

    if (!driverRegisterResponse.ok) {
      throw new Error('Driver registration failed');
    }

    const driverToken = driverRegisterData.token;

    // Step 2: Test check-registration endpoint
    console.log('\n2. Testing check-registration endpoint...');
    const checkRegResponse = await fetch(`${BASE_URL}/api/drivers/check-registration`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${driverToken}`,
      }
    });

    console.log('📊 Check-registration response status:', checkRegResponse.status);

    if (checkRegResponse.ok) {
      const checkRegData = await checkRegResponse.json();
      console.log('✅ Check-registration data:', checkRegData);
    } else {
      const errorData = await checkRegResponse.json();
      console.log('❌ Check-registration error:', errorData);
    }

    // Step 3: Register a new rider and create ride request
    console.log('\n3. Registering new rider...');
    const riderRegisterResponse = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        firstName: 'Local',
        lastName: 'Rider',
        email: riderEmail,
        phone: `93${timestamp.toString().slice(-10)}`,
        password: 'password123',
        userType: 'rider'
      })
    });

    const riderRegisterData = await riderRegisterResponse.json();
    console.log('✅ Rider registration response:', riderRegisterData);

    if (!riderRegisterResponse.ok) {
      throw new Error('Rider registration failed');
    }

    const riderToken = riderRegisterData.token;

    // Step 4: Create a ride request
    console.log('\n4. Creating ride request...');
    const rideRequestResponse = await fetch(`${BASE_URL}/api/ride-requests/request-ride`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${riderToken}`,
      },
      body: JSON.stringify({
        pickup: {
          latitude: 35.9208,
          longitude: 74.3144,
          address: 'Gilgit City Center'
        },
        destination: {
          latitude: 35.9308,
          longitude: 74.3244,
          address: 'Gilgit Airport'
        },
        offeredFare: 500,
        radiusMeters: 1200,
        paymentMethod: 'cash',
        vehicleType: 'any',
        notes: 'Local test ride request'
      })
    });

    const rideRequestData = await rideRequestResponse.json();
    console.log('✅ Ride request creation response:', rideRequestData);

    if (!rideRequestResponse.ok) {
      throw new Error('Ride request creation failed');
    }

    // Step 5: Driver sees available ride requests
    console.log('\n5. Fetching driver available ride requests...');
    const rideRequestsResponse = await fetch(`${BASE_URL}/api/ride-requests/available-simple`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${driverToken}`,
      }
    });

    console.log('📊 Ride requests response status:', rideRequestsResponse.status);

    if (rideRequestsResponse.ok) {
      const rideRequestsData = await rideRequestsResponse.json();
      console.log('✅ Driver available ride requests:', rideRequestsData);
    } else {
      const errorData = await rideRequestsResponse.json();
      console.log('❌ Driver available ride requests error:', errorData);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exitCode = 1;
  }
}

testFreshDriverLocal();


