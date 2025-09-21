const fetch = require('node-fetch').default;

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function testFreshDriver() {
  try {
    console.log('🧪 Testing fresh driver flow...');
    
    const timestamp = Date.now();
    const driverEmail = `testdriver${timestamp}@example.com`;
    const riderEmail = `testrider${timestamp}@example.com`;
    
    // Step 1: Register a new driver
    console.log('\n1. Registering new driver...');
    const driverRegisterResponse = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        firstName: 'Test',
        lastName: 'Driver',
        email: driverEmail,
        phone: `1234567${timestamp.toString().slice(-3)}`,
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
      
      if (checkRegData.isRegistered) {
        console.log('✅ Driver is registered and can access ride requests!');
      } else {
        console.log('❌ Driver is not registered - this is the issue!');
      }
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
        firstName: 'Test',
        lastName: 'Rider',
        email: riderEmail,
        phone: `1234568${timestamp.toString().slice(-3)}`,
        password: 'password123',
        userType: 'rider'
      })
    });
    
    const riderRegisterData = await riderRegisterResponse.json();
    console.log('✅ Rider registration response:', riderRegisterData);
    
    if (riderRegisterResponse.ok) {
      const riderToken = riderRegisterData.token;
      
      // Create a ride request
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
          notes: 'Test ride request'
        })
      });
      
      const rideRequestData = await rideRequestResponse.json();
      console.log('✅ Ride request creation response:', rideRequestData);
      
      // Now test driver seeing the ride request
      console.log('\n5. Testing driver seeing the new ride request...');
      const rideRequestsResponse = await fetch(`${BASE_URL}/api/ride-requests/available-simple`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${driverToken}`,
        }
      });
      
      if (rideRequestsResponse.ok) {
        const rideRequestsData = await rideRequestsResponse.json();
        console.log('✅ Updated ride requests data:', rideRequestsData);
        console.log(`📈 Now found ${rideRequestsData.total || 0} ride requests`);
      } else {
        const errorData = await rideRequestsResponse.json();
        console.log('❌ Updated ride requests error:', errorData);
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testFreshDriver();
