const axios = require('axios');

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function testOnlineDriver() {
  try {
    console.log('🔍 Testing with online driver...');
    
    // Step 1: Login as driver
    console.log('\n1. Logging in as driver...');
    const driverLoginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: 'samran@gandu.com',
      password: '123456',
      expectedUserType: 'driver'
    });
    
    console.log('✅ Driver logged in:', driverLoginResponse.data.user.email);
    const driverToken = driverLoginResponse.data.token;
    
    // Step 2: Check driver status
    console.log('\n2. Checking driver status...');
    const checkResponse = await axios.get(`${BASE_URL}/api/drivers/check-registration`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver status:', {
      isOnline: checkResponse.data.isOnline,
      isAvailable: checkResponse.data.driverProfile?.isAvailable,
      isApproved: checkResponse.data.isApproved
    });
    
    // Step 3: Set driver online if not already
    if (!checkResponse.data.isOnline) {
      console.log('\n3. Setting driver online...');
      const toggleResponse = await axios.post(`${BASE_URL}/api/drivers/toggle-status`, {}, {
        headers: { Authorization: `Bearer ${driverToken}` }
      });
      
      console.log('✅ Driver status toggled:', toggleResponse.data);
    } else {
      console.log('\n3. Driver is already online');
    }
    
    // Step 4: Update driver location
    console.log('\n4. Updating driver location...');
    const locationResponse = await axios.post(`${BASE_URL}/api/drivers/location`, {
      latitude: 35.91123040036913,
      longitude: 74.34989763147254
    }, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver location updated:', locationResponse.data);
    
    // Step 5: Create a new ride request as a rider
    console.log('\n5. Creating new ride request as rider...');
    
    // Register a new rider
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
      offeredFare: 400,
      radiusMeters: 1200,
      paymentMethod: 'cash',
      vehicleType: 'any',
      notes: 'Test ride request with online driver'
    }, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    
    console.log('✅ Ride request created:', rideRequestResponse.data);
    
    // Step 6: Check if driver can see the new request
    console.log('\n6. Checking if driver can see the new request...');
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
    
    // Step 7: Check debug drivers to see driver status
    console.log('\n7. Checking debug drivers...');
    const debugResponse = await axios.get(`${BASE_URL}/api/ride-requests/debug-drivers`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Debug drivers info:', {
      totalDrivers: debugResponse.data.totalDrivers,
      onlineDrivers: debugResponse.data.onlineDrivers,
      availableDrivers: debugResponse.data.availableDrivers,
      approvedDrivers: debugResponse.data.approvedDrivers,
      driversWithLocation: debugResponse.data.driversWithLocation
    });
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testOnlineDriver();
