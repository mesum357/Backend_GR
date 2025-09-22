const axios = require('axios');

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function fixDriverOnline() {
  try {
    console.log('🔍 Fixing driver online status...');
    
    // Step 1: Login as driver
    console.log('\n1. Logging in as driver...');
    const driverLoginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: 'samran@gandu.com',
      password: '123456',
      expectedUserType: 'driver'
    });
    
    console.log('✅ Driver logged in:', driverLoginResponse.data.user.email);
    const driverToken = driverLoginResponse.data.token;
    
    // Step 2: Check current driver status
    console.log('\n2. Checking current driver status...');
    const checkResponse = await axios.get(`${BASE_URL}/api/drivers/check-registration`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Current driver status:', {
      isRegistered: checkResponse.data.isRegistered,
      isApproved: checkResponse.data.isApproved,
      isVerified: checkResponse.data.isVerified,
      isOnline: checkResponse.data.isOnline,
      hasDriverProfile: !!checkResponse.data.driverProfile
    });
    
    // Step 3: If driver is offline, set them online
    if (!checkResponse.data.isOnline) {
      console.log('\n3. Driver is offline, setting online...');
      const toggleResponse = await axios.post(`${BASE_URL}/api/drivers/toggle-status`, {}, {
        headers: { Authorization: `Bearer ${driverToken}` }
      });
      
      console.log('✅ Driver status toggle response:', toggleResponse.data);
    } else {
      console.log('\n3. Driver is already online');
    }
    
    // Step 4: Update driver location
    console.log('\n4. Updating driver location...');
    const locationResponse = await axios.post(`${BASE_URL}/api/drivers/location`, {
      latitude: 35.91123052970746,
      longitude: 74.34989800233608
    }, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver location updated:', locationResponse.data);
    
    // Step 5: Verify driver is online
    console.log('\n5. Verifying driver is online...');
    const checkResponse2 = await axios.get(`${BASE_URL}/api/drivers/check-registration`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver status after toggle:', {
      isRegistered: checkResponse2.data.isRegistered,
      isApproved: checkResponse2.data.isApproved,
      isVerified: checkResponse2.data.isVerified,
      isOnline: checkResponse2.data.isOnline,
      hasDriverProfile: !!checkResponse2.data.driverProfile
    });
    
    // Step 6: Test creating a ride request to see if driver gets notified
    console.log('\n6. Testing ride request creation...');
    
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
      offeredFare: 900,
      radiusMeters: 1200,
      paymentMethod: 'cash',
      vehicleType: 'any',
      notes: 'Test ride request with online driver'
    }, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    
    console.log('✅ Ride request created:', rideRequestResponse.data);
    
    // Step 7: Check if driver can see the new request
    console.log('\n7. Checking if driver can see the new request...');
    const requestsResponse = await axios.get(`${BASE_URL}/api/ride-requests/available-simple`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Available ride requests after new request:', requestsResponse.data.rideRequests.length);
    if (requestsResponse.data.rideRequests.length > 0) {
      console.log('🎉 SUCCESS! Driver can see ride requests!');
      console.log('📋 Request details:', requestsResponse.data.rideRequests[0]);
    } else {
      console.log('❌ Driver cannot see any ride requests');
    }
    
  } catch (error) {
    console.error('❌ Fix failed:', error.response?.data || error.message);
  }
}

fixDriverOnline();
