const fetch = require('node-fetch').default;

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function testDriverRideRequests() {
  try {
    console.log('🧪 Testing driver registration and ride requests...');
    
    // Step 1: Register a test driver
    console.log('\n1. Registering test driver...');
    const registerResponse = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        firstName: 'Test',
        lastName: 'Driver',
        email: 'testdriver@example.com',
        phone: '1234567890',
        password: 'password123',
        userType: 'driver'
      })
    });
    
    const registerData = await registerResponse.json();
    console.log('✅ Driver registration response:', registerData);
    
    if (!registerResponse.ok) {
      console.log('❌ Driver registration failed, trying login instead...');
      
      // Try to login with existing driver
      const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'testdriver@example.com',
          password: 'password123',
          expectedUserType: 'driver'
        })
      });
      
      const loginData = await loginResponse.json();
      console.log('✅ Driver login response:', loginData);
      
      if (!loginResponse.ok) {
        throw new Error('Both registration and login failed');
      }
      
      var token = loginData.token;
    } else {
      var token = registerData.token;
    }
    
    // Step 2: Test ride requests endpoint
    console.log('\n2. Testing ride requests endpoint...');
    const rideRequestsResponse = await fetch(`${BASE_URL}/api/ride-requests/available-simple`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      }
    });
    
    console.log('📊 Ride requests response status:', rideRequestsResponse.status);
    
    if (rideRequestsResponse.ok) {
      const rideRequestsData = await rideRequestsResponse.json();
      console.log('✅ Ride requests data:', rideRequestsData);
      console.log(`📈 Found ${rideRequestsData.total || 0} ride requests`);
    } else {
      const errorData = await rideRequestsResponse.json();
      console.log('❌ Ride requests error:', errorData);
    }
    
    // Step 3: Test creating a ride request (as rider)
    console.log('\n3. Creating a test ride request...');
    const riderRegisterResponse = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        firstName: 'Test',
        lastName: 'Rider',
        email: 'testrider@example.com',
        phone: '1234567891',
        password: 'password123',
        userType: 'rider'
      })
    });
    
    const riderRegisterData = await riderRegisterResponse.json();
    console.log('✅ Rider registration response:', riderRegisterData);
    
    if (riderRegisterResponse.ok) {
      const riderToken = riderRegisterData.token;
      
      // Create a ride request
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
      console.log('\n4. Testing driver seeing the new ride request...');
      const updatedRideRequestsResponse = await fetch(`${BASE_URL}/api/ride-requests/available-simple`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        }
      });
      
      if (updatedRideRequestsResponse.ok) {
        const updatedRideRequestsData = await updatedRideRequestsResponse.json();
        console.log('✅ Updated ride requests data:', updatedRideRequestsData);
        console.log(`📈 Now found ${updatedRideRequestsData.total || 0} ride requests`);
      } else {
        const errorData = await updatedRideRequestsResponse.json();
        console.log('❌ Updated ride requests error:', errorData);
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testDriverRideRequests();
