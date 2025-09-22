const axios = require('axios');

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function testCompleteFlow() {
  try {
    console.log('🧪 Testing complete ride request flow...');
    
    // Step 1: Register a new rider
    console.log('\n1. Registering new rider...');
    const riderRegisterResponse = await axios.post(`${BASE_URL}/api/auth/register`, {
      firstName: 'Test',
      lastName: 'Rider',
      email: `testrider${Date.now()}@example.com`,
      phone: `123456${Date.now().toString().slice(-4)}`,
      password: '123456',
      userType: 'rider'
    });
    
    console.log('✅ Rider registered:', riderRegisterResponse.data.user.email);
    const riderToken = riderRegisterResponse.data.token;
    
    // Step 2: Login as driver
    console.log('\n2. Logging in as driver...');
    const driverLoginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: 'samran@gandu.com',
      password: '123456',
      expectedUserType: 'driver'
    });
    
    console.log('✅ Driver logged in:', driverLoginResponse.data.user.email);
    const driverToken = driverLoginResponse.data.token;
    
    // Step 3: Update driver location
    console.log('\n3. Updating driver location...');
    const locationResponse = await axios.post(`${BASE_URL}/api/drivers/location`, {
      latitude: 35.9208,
      longitude: 74.3144
    }, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver location updated:', locationResponse.data);
    
    // Step 4: Create ride request as rider
    console.log('\n4. Creating ride request as rider...');
    const rideRequestResponse = await axios.post(`${BASE_URL}/api/ride-requests/request-ride`, {
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
      offeredFare: 100,
      radiusMeters: 1200,
      paymentMethod: 'cash',
      vehicleType: 'any',
      notes: 'Test ride request'
    }, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    
    console.log('✅ Ride request created:', rideRequestResponse.data);
    
    // Step 5: Check if driver can see the request
    console.log('\n5. Checking if driver can see the request...');
    const driverRequestsResponse = await axios.get(`${BASE_URL}/api/ride-requests/available-simple`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver sees requests:', driverRequestsResponse.data.rideRequests.length);
    if (driverRequestsResponse.data.rideRequests.length > 0) {
      console.log('🎉 SUCCESS! Driver can see ride requests!');
      console.log('📋 Request details:', driverRequestsResponse.data.rideRequests[0]);
    } else {
      console.log('❌ Driver cannot see any ride requests');
    }
    
    // Step 6: Check debug drivers to see what's happening
    console.log('\n6. Checking debug drivers...');
    const debugResponse = await axios.get(`${BASE_URL}/api/ride-requests/debug-drivers`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Debug info:', {
      totalDrivers: debugResponse.data.totalDrivers,
      onlineDrivers: debugResponse.data.onlineDrivers,
      availableDrivers: debugResponse.data.availableDrivers,
      approvedDrivers: debugResponse.data.approvedDrivers,
      driversWithLocation: debugResponse.data.driversWithLocation
    });
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    console.error('Full error:', error);
  }
}

testCompleteFlow();
