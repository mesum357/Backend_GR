const axios = require('axios');

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function testMobileCoordinates() {
  try {
    console.log('🔍 Testing with mobile app coordinates...');
    
    // Step 1: Login as driver
    console.log('\n1. Logging in as driver...');
    const driverLoginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: 'samran@gandu.com',
      password: '123456',
      expectedUserType: 'driver'
    });
    
    console.log('✅ Driver logged in:', driverLoginResponse.data.user.email);
    const driverToken = driverLoginResponse.data.token;
    
    // Step 2: Test with exact coordinates from mobile app
    console.log('\n2. Testing with mobile app coordinates...');
    const mobileCoordinates = {
      latitude: 35.91123040036913,
      longitude: 74.34989763147254
    };
    
    try {
      const locationResponse = await axios.post(`${BASE_URL}/api/drivers/location`, mobileCoordinates, {
        headers: { Authorization: `Bearer ${driverToken}` }
      });
      
      console.log('✅ Mobile coordinates location update successful:', locationResponse.data);
    } catch (error) {
      console.log('❌ Mobile coordinates location update failed:');
      console.log('Status:', error.response?.status);
      console.log('Error:', error.response?.data);
    }
    
    // Step 3: Test ride request creation with mobile coordinates
    console.log('\n3. Testing ride request creation...');
    try {
      const rideRequestResponse = await axios.post(`${BASE_URL}/api/ride-requests/request-ride`, {
        pickup: {
          latitude: 35.911263,
          longitude: 74.3501778,
          address: 'Current Location'
        },
        destination: {
          latitude: 35.915131242377,
          longitude: 74.31776007637382,
          address: 'MM Market, Col Ihsan Ali Road, W889+452, Gilgit'
        },
        offeredFare: 258,
        radiusMeters: 1200,
        paymentMethod: 'cash',
        vehicleType: 'any',
        notes: 'Test ride request with mobile coordinates'
      }, {
        headers: { Authorization: `Bearer ${driverToken}` }
      });
      
      console.log('✅ Ride request created:', rideRequestResponse.data);
    } catch (error) {
      console.log('❌ Ride request creation failed:', error.response?.data || error.message);
    }
    
    // Step 4: Check if driver can see the request
    console.log('\n4. Checking if driver can see the request...');
    try {
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
    } catch (error) {
      console.log('❌ Could not get available requests:', error.response?.data || error.message);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testMobileCoordinates();
