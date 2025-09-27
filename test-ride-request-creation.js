const fetch = require('node-fetch').default;

const BASE_URL = 'http://192.168.137.1:8080';

async function testRideRequestCreation() {
  try {
    console.log('🧪 Testing ride request creation...');
    
    // Step 1: Login as rider
    console.log('\n1. Logging in as rider...');
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
    console.log('✅ Rider login response:', loginData);
    
    if (!loginResponse.ok) {
      throw new Error('Rider login failed');
    }
    
    const token = loginData.token;
    
    // Step 2: Create ride request
    console.log('\n2. Creating ride request...');
    const rideRequestResponse = await fetch(`${BASE_URL}/api/ride-requests/request-ride`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
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
        paymentMethod: 'cash',
        vehicleType: 'car',
        notes: 'Test ride request'
      })
    });
    
    console.log('📊 Ride request response status:', rideRequestResponse.status);
    
    if (rideRequestResponse.ok) {
      const rideRequestData = await rideRequestResponse.json();
      console.log('✅ Ride request created:', rideRequestData);
    } else {
      const errorData = await rideRequestResponse.json();
      console.log('❌ Ride request creation error:', errorData);
    }
    
    // Step 3: Check available ride requests
    console.log('\n3. Checking available ride requests...');
    const availableResponse = await fetch(`${BASE_URL}/api/ride-requests/available-simple`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      }
    });
    
    console.log('📊 Available requests response status:', availableResponse.status);
    
    if (availableResponse.ok) {
      const availableData = await availableResponse.json();
      console.log('✅ Available requests:', availableData);
    } else {
      const errorData = await availableResponse.json();
      console.log('❌ Available requests error:', errorData);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testRideRequestCreation();
