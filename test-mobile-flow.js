const axios = require('axios');

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function testMobileFlow() {
  try {
    console.log('🔍 Testing exact mobile app flow...');
    
    // Step 1: Login as driver (simulating mobile app login)
    console.log('\n1. Logging in as driver...');
    const driverLoginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: 'samran@gandu.com',
      password: '123456',
      expectedUserType: 'driver'
    });
    
    console.log('✅ Driver logged in:', driverLoginResponse.data.user.email);
    const driverToken = driverLoginResponse.data.token;
    
    // Step 2: Check driver registration (simulating mobile app check)
    console.log('\n2. Checking driver registration...');
    const checkResponse = await axios.get(`${BASE_URL}/api/drivers/check-registration`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver registration status:', {
      isRegistered: checkResponse.data.isRegistered,
      isApproved: checkResponse.data.isApproved,
      isOnline: checkResponse.data.isOnline,
      hasDriverProfile: !!checkResponse.data.driverProfile
    });
    
    // Step 3: Toggle driver status (simulating mobile app toggle)
    console.log('\n3. Toggling driver status...');
    const toggleResponse = await axios.post(`${BASE_URL}/api/drivers/toggle-status`, {}, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver status toggled:', toggleResponse.data);
    
    // Step 4: Update driver location (simulating mobile app location update)
    console.log('\n4. Updating driver location...');
    const locationResponse = await axios.post(`${BASE_URL}/api/drivers/location`, {
      latitude: 35.91123040036913,
      longitude: 74.34989763147254
    }, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver location updated:', locationResponse.data);
    
    // Step 5: Check available ride requests (simulating mobile app fetch)
    console.log('\n5. Checking available ride requests...');
    const requestsResponse = await axios.get(`${BASE_URL}/api/ride-requests/available-simple`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Available ride requests:', requestsResponse.data.rideRequests.length);
    if (requestsResponse.data.rideRequests.length > 0) {
      console.log('🎉 SUCCESS! Driver can see ride requests!');
      console.log('📋 Request details:', requestsResponse.data.rideRequests[0]);
    } else {
      console.log('❌ Driver cannot see any ride requests');
    }
    
    // Step 6: Create a new ride request as a rider to test real-time flow
    console.log('\n6. Creating new ride request as rider...');
    
    // First, register a new rider
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
    
    // Create ride request
    const rideRequestResponse = await axios.post(`${BASE_URL}/api/ride-requests/request-ride`, {
      pickup: {
        latitude: 35.911263,
        longitude: 74.3501778,
        address: 'Current Location'
      },
      destination: {
        latitude: 35.915131242377,
        longitude: 74.31776007637382,
        address: 'Test Destination'
      },
      offeredFare: 300,
      radiusMeters: 1200,
      paymentMethod: 'cash',
      vehicleType: 'any',
      notes: 'Test ride request for real-time flow'
    }, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    
    console.log('✅ Ride request created:', rideRequestResponse.data);
    
    // Step 7: Check if driver can see the new request
    console.log('\n7. Checking if driver can see the new request...');
    const newRequestsResponse = await axios.get(`${BASE_URL}/api/ride-requests/available-simple`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Available ride requests after new request:', newRequestsResponse.data.rideRequests.length);
    if (newRequestsResponse.data.rideRequests.length > 0) {
      console.log('🎉 SUCCESS! Driver can see the new ride request!');
      console.log('📋 New request details:', newRequestsResponse.data.rideRequests[0]);
    } else {
      console.log('❌ Driver cannot see the new ride request');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testMobileFlow();
