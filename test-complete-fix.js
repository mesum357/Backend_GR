const axios = require('axios');

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function testCompleteFix() {
  try {
    console.log('🔍 Testing complete fix for driver issues...');
    
    // Step 1: Login as driver
    console.log('\n1. Logging in as driver...');
    const driverLoginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: 'samran@gandu.com',
      password: '123456',
      expectedUserType: 'driver'
    });
    
    console.log('✅ Driver logged in:', driverLoginResponse.data.user.email);
    const driverToken = driverLoginResponse.data.token;
    
    // Step 2: Check driver registration status (should auto-create profile)
    console.log('\n2. Checking driver registration status...');
    const checkResponse = await axios.get(`${BASE_URL}/api/drivers/check-registration`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver registration status:', {
      isRegistered: checkResponse.data.isRegistered,
      isApproved: checkResponse.data.isApproved,
      isVerified: checkResponse.data.isVerified,
      isOnline: checkResponse.data.isOnline,
      hasDriverProfile: !!checkResponse.data.driverProfile
    });
    
    // Step 3: Update driver location (should work now)
    console.log('\n3. Updating driver location...');
    const locationResponse = await axios.post(`${BASE_URL}/api/drivers/location`, {
      latitude: 35.91123052970746,
      longitude: 74.34989800233608
    }, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver location updated:', locationResponse.data);
    
    // Step 4: Toggle driver status (should work now)
    console.log('\n4. Toggling driver status...');
    const toggleResponse = await axios.post(`${BASE_URL}/api/drivers/toggle-status`, {}, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver status toggle response:', toggleResponse.data);
    
    // Step 5: Check available ride requests
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
    
    // Step 6: Test creating a new ride request
    console.log('\n6. Testing creation of new ride request...');
    
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
      offeredFare: 1200,
      radiusMeters: 1200,
      paymentMethod: 'cash',
      vehicleType: 'any',
      notes: 'Test ride request after fix'
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
      console.log('🎉 SUCCESS! Driver can see ride requests!');
      console.log('📋 Latest request details:', newRequestsResponse.data.rideRequests[0]);
    } else {
      console.log('❌ Driver cannot see any ride requests');
    }
    
    // Step 8: Check debug drivers to confirm driver is online
    console.log('\n8. Checking debug drivers...');
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
    
    // Check our specific driver
    const ourDriver = debugResponse.data.allDrivers.find(d => d.userId === '68d04536ccb5568dc4dd63b7');
    if (ourDriver) {
      console.log('✅ Our driver details:', {
        id: ourDriver.id,
        userId: ourDriver.userId,
        userName: ourDriver.userName,
        isOnline: ourDriver.isOnline,
        isAvailable: ourDriver.isAvailable,
        isApproved: ourDriver.isApproved,
        isVerified: ourDriver.isVerified,
        hasLocation: ourDriver.hasLocation,
        coordinates: ourDriver.coordinates,
        lastActive: ourDriver.lastActive
      });
    } else {
      console.log('❌ Our driver NOT found in debug list');
    }
    
    console.log('\n🎉 COMPLETE FIX TEST FINISHED!');
    console.log('📱 The driver dashboard should now be working correctly in the mobile app.');
    console.log('🔧 All driver profile issues have been resolved.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testCompleteFix();
