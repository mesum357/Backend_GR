const axios = require('axios');

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function testCompleteFlowDebug() {
  try {
    console.log('🔍 TESTING COMPLETE FLOW - STEP BY STEP DEBUG');
    console.log('='.repeat(60));
    
    // STEP 1: Create a test rider account and create ride request
    console.log('\n📱 STEP 1: Creating test rider and ride request...');
    
    const riderEmail = `testrider${Date.now()}@example.com`;
    const riderPhone = `123456${Date.now().toString().slice(-4)}`;
    
    const riderRegisterResponse = await axios.post(`${BASE_URL}/api/auth/register`, {
      firstName: 'Test',
      lastName: 'Rider',
      email: riderEmail,
      phone: riderPhone,
      password: '123456',
      userType: 'rider'
    });
    
    console.log('✅ Rider registered:', {
      email: riderRegisterResponse.data.user.email,
      id: riderRegisterResponse.data.user._id
    });
    const riderToken = riderRegisterResponse.data.token;
    
    // Create ride request
    console.log('\n🚗 Creating ride request...');
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
      offeredFare: 800,
      radiusMeters: 1200,
      paymentMethod: 'cash',
      vehicleType: 'any',
      notes: 'Test ride request for debugging'
    }, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    
    console.log('✅ Ride request created:', {
      id: rideRequestResponse.data.rideRequest.id,
      status: rideRequestResponse.data.rideRequest.status,
      driversNotified: rideRequestResponse.data.rideRequest.driversNotified,
      distance: rideRequestResponse.data.rideRequest.distance,
      offeredFare: rideRequestResponse.data.rideRequest.offeredFare
    });
    
    // STEP 2: Login as driver and check dashboard
    console.log('\n🚕 STEP 2: Testing driver dashboard...');
    
    const driverLoginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: 'samran@gandu.com',
      password: '123456',
      expectedUserType: 'driver'
    });
    
    console.log('✅ Driver logged in:', {
      email: driverLoginResponse.data.user.email,
      id: driverLoginResponse.data.user._id,
      userType: driverLoginResponse.data.user.userType
    });
    const driverToken = driverLoginResponse.data.token;
    
    // Check driver registration status
    console.log('\n🔍 Checking driver registration status...');
    const checkResponse = await axios.get(`${BASE_URL}/api/drivers/check-registration`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver registration status:', {
      isRegistered: checkResponse.data.isRegistered,
      isApproved: checkResponse.data.isApproved,
      isVerified: checkResponse.data.isVerified,
      isOnline: checkResponse.data.isOnline,
      hasDriverProfile: !!checkResponse.data.driverProfile,
      driverProfileId: checkResponse.data.driverProfile?._id
    });
    
    // Set driver online
    console.log('\n🔧 Setting driver online...');
    const toggleResponse = await axios.post(`${BASE_URL}/api/drivers/toggle-status`, {}, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver status toggle response:', toggleResponse.data);
    
    // Update driver location
    console.log('\n📍 Updating driver location...');
    const locationResponse = await axios.post(`${BASE_URL}/api/drivers/location`, {
      latitude: 35.91123052970746,
      longitude: 74.34989800233608
    }, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver location updated:', locationResponse.data);
    
    // Check available ride requests
    console.log('\n📋 Checking available ride requests...');
    const requestsResponse = await axios.get(`${BASE_URL}/api/ride-requests/available-simple`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Available ride requests:', {
      count: requestsResponse.data.rideRequests.length,
      requests: requestsResponse.data.rideRequests.map(req => ({
        id: req.id,
        pickupLocation: req.pickupLocation,
        destination: req.dropoffLocation,
        fare: req.estimatedFare,
        riderName: req.riderName,
        status: req.status,
        createdAt: req.createdAt
      }))
    });
    
    // STEP 3: Check debug information
    console.log('\n🔍 STEP 3: Checking debug information...');
    
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
    
    // STEP 4: Test creating another ride request to see real-time behavior
    console.log('\n🔄 STEP 4: Testing real-time ride request creation...');
    
    const rideRequest2Response = await axios.post(`${BASE_URL}/api/ride-requests/request-ride`, {
      pickup: {
        latitude: 35.911263,
        longitude: 74.3501778,
        address: 'Current Location 2'
      },
      destination: {
        latitude: 35.915131242377,
        longitude: 74.31776007637382,
        address: 'Test Destination 2'
      },
      offeredFare: 900,
      radiusMeters: 1200,
      paymentMethod: 'cash',
      vehicleType: 'any',
      notes: 'Second test ride request for real-time testing'
    }, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    
    console.log('✅ Second ride request created:', {
      id: rideRequest2Response.data.rideRequest.id,
      status: rideRequest2Response.data.rideRequest.status,
      driversNotified: rideRequest2Response.data.rideRequest.driversNotified,
      distance: rideRequest2Response.data.rideRequest.distance,
      offeredFare: rideRequest2Response.data.rideRequest.offeredFare
    });
    
    // Check if driver can see the new request
    console.log('\n📋 Checking if driver can see the new request...');
    const requests2Response = await axios.get(`${BASE_URL}/api/ride-requests/available-simple`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Available ride requests after second request:', {
      count: requests2Response.data.rideRequests.length,
      requests: requests2Response.data.rideRequests.map(req => ({
        id: req.id,
        pickupLocation: req.pickupLocation,
        destination: req.dropoffLocation,
        fare: req.estimatedFare,
        riderName: req.riderName,
        status: req.status,
        createdAt: req.createdAt
      }))
    });
    
    console.log('\n🎉 COMPLETE FLOW TEST FINISHED!');
    console.log('='.repeat(60));
    console.log('📊 SUMMARY:');
    console.log(`   📱 Rider created: ${riderEmail}`);
    console.log(`   🚗 Ride requests created: 2`);
    console.log(`   📋 Driver can see requests: ${requests2Response.data.rideRequests.length}`);
    console.log(`   🔧 Driver online: ${ourDriver?.isOnline || 'Unknown'}`);
    console.log(`   📍 Driver has location: ${ourDriver?.hasLocation || 'Unknown'}`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    console.error('Full error:', error);
  }
}

testCompleteFlowDebug();
