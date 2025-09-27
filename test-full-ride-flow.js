const fetch = require('node-fetch').default;

const BASE_URL = 'http://192.168.137.1:8080';

async function testFullRideFlow() {
  try {
    console.log('🧪 Testing full ride request flow...');
    
    // Step 1: Create a new rider account
    console.log('\n1. Creating new rider account...');
    const registerResponse = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'newrider@example.com',
        password: 'password123',
        firstName: 'New',
        lastName: 'Rider',
        phone: '9876543210',
        userType: 'rider'
      })
    });
    
    const registerData = await registerResponse.json();
    console.log('📊 Registration response status:', registerResponse.status);
    
    if (!registerResponse.ok) {
      console.log('❌ Registration failed:', registerData);
      return;
    }
    
    console.log('✅ Rider account created successfully');
    
    // Step 2: Login as rider
    console.log('\n2. Logging in as rider...');
    const riderLoginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'newrider@example.com',
        password: 'password123',
        expectedUserType: 'rider'
      })
    });
    
    const riderLoginData = await riderLoginResponse.json();
    console.log('📊 Rider login response status:', riderLoginResponse.status);
    
    if (!riderLoginResponse.ok) {
      console.log('❌ Rider login failed:', riderLoginData);
      return;
    }
    
    console.log('✅ Rider login successful');
    const riderToken = riderLoginData.token;
    
    // Step 3: Create ride request
    console.log('\n3. Creating ride request...');
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
      return;
    }
    
    // Step 4: Login as driver
    console.log('\n4. Logging in as driver...');
    const driverLoginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
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
    
    const driverLoginData = await driverLoginResponse.json();
    console.log('📊 Driver login response status:', driverLoginResponse.status);
    
    if (!driverLoginResponse.ok) {
      console.log('❌ Driver login failed:', driverLoginData);
      return;
    }
    
    console.log('✅ Driver login successful');
    const driverToken = driverLoginData.token;
    
    // Step 5: Check available ride requests
    console.log('\n5. Checking available ride requests...');
    const availableResponse = await fetch(`${BASE_URL}/api/ride-requests/available-simple`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${driverToken}`,
      }
    });
    
    console.log('📊 Available requests response status:', availableResponse.status);
    
    if (availableResponse.ok) {
      const availableData = await availableResponse.json();
      console.log('✅ Available requests:', availableData);
      console.log(`📈 Found ${availableData.rideRequests?.length || 0} ride requests`);
    } else {
      const errorData = await availableResponse.json();
      console.log('❌ Available requests error:', errorData);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testFullRideFlow();
