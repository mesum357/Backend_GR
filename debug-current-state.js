const axios = require('axios');

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function debugCurrentState() {
  try {
    console.log('🔍 Debugging current state of ride requests and drivers...');
    
    // Step 1: Login as driver
    console.log('\n1. Logging in as driver...');
    const driverLoginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: 'samran@gandu.com',
      password: '123456',
      expectedUserType: 'driver'
    });
    
    console.log('✅ Driver logged in:', driverLoginResponse.data.user.email);
    const driverToken = driverLoginResponse.data.token;
    
    // Step 2: Check driver registration and status
    console.log('\n2. Checking driver registration and status...');
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
    
    // Step 3: Check debug drivers info
    console.log('\n3. Checking debug drivers info...');
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
    
    // Step 4: Check available ride requests
    console.log('\n4. Checking available ride requests...');
    const requestsResponse = await axios.get(`${BASE_URL}/api/ride-requests/available-simple`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Available ride requests:', requestsResponse.data.rideRequests.length);
    if (requestsResponse.data.rideRequests.length > 0) {
      console.log('📋 Ride requests details:');
      requestsResponse.data.rideRequests.forEach((request, index) => {
        console.log(`  Request ${index + 1}:`, {
          id: request.id,
          status: request.status,
          pickupLocation: request.pickupLocation,
          destination: request.dropoffLocation,
          fare: request.estimatedFare,
          createdAt: request.createdAt,
          riderName: request.riderName
        });
      });
    } else {
      console.log('❌ No ride requests found');
    }
    
    // Step 5: Check all ride requests in database (including expired/cancelled)
    console.log('\n5. Checking all ride requests in database...');
    try {
      const allRequestsResponse = await axios.get(`${BASE_URL}/api/ride-requests/debug-all-requests`, {
        headers: { Authorization: `Bearer ${driverToken}` }
      });
      
      console.log('✅ All ride requests in database:', allRequestsResponse.data);
    } catch (error) {
      console.log('❌ Could not get all ride requests:', error.response?.data || error.message);
    }
    
    // Step 6: Test creating a new ride request
    console.log('\n6. Testing creation of new ride request...');
    
    // Register a new rider
    const riderRegisterResponse = await axios.post(`${BASE_URL}/api/auth/register`, {
      firstName: 'Debug',
      lastName: 'Rider',
      email: `debugrider${Date.now()}@example.com`,
      phone: `123456${Date.now().toString().slice(-4)}`,
      password: '123456',
      userType: 'rider'
    });
    
    console.log('✅ Debug rider registered:', riderRegisterResponse.data.user.email);
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
      offeredFare: 500,
      radiusMeters: 1200,
      paymentMethod: 'cash',
      vehicleType: 'any',
      notes: 'Debug test ride request'
    }, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    
    console.log('✅ New ride request created:', rideRequestResponse.data);
    
    // Step 7: Check if driver can see the new request
    console.log('\n7. Checking if driver can see the new request...');
    const newRequestsResponse = await axios.get(`${BASE_URL}/api/ride-requests/available-simple`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Available ride requests after new request:', newRequestsResponse.data.rideRequests.length);
    if (newRequestsResponse.data.rideRequests.length > 0) {
      console.log('📋 Updated ride requests:');
      newRequestsResponse.data.rideRequests.forEach((request, index) => {
        console.log(`  Request ${index + 1}:`, {
          id: request.id,
          status: request.status,
          pickupLocation: request.pickupLocation,
          destination: request.dropoffLocation,
          fare: request.estimatedFare,
          createdAt: request.createdAt,
          riderName: request.riderName
        });
      });
    } else {
      console.log('❌ Driver still cannot see any ride requests');
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.response?.data || error.message);
  }
}

debugCurrentState();
