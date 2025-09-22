const axios = require('axios');

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function fixDeployedServer() {
  try {
    console.log('🔧 Fixing deployed server...');
    
    // Step 1: Login as the existing driver
    console.log('\n1. Logging in as existing driver...');
    const loginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: 'samran@gandu.com',
      password: '123456',
      expectedUserType: 'driver'
    });
    
    console.log('✅ Driver logged in:', loginResponse.data.user.email);
    const driverToken = loginResponse.data.token;
    
    // Step 2: Check current driver status
    console.log('\n2. Checking current driver status...');
    const checkResponse = await axios.get(`${BASE_URL}/api/drivers/check-registration`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Current driver status:', checkResponse.data);
    
    // Step 3: Try to create driver profile using the debug endpoint
    console.log('\n3. Creating driver profile...');
    try {
      const createProfileResponse = await axios.post(`${BASE_URL}/api/drivers/create-profile`, {
        vehicleInfo: {
          make: 'Toyota',
          model: 'Corolla',
          year: 2020,
          color: 'White',
          plateNumber: 'TEST001',
          vehicleType: 'car'
        },
        licenseNumber: 'LIC123',
        licenseExpiry: '2026-12-31T00:00:00.000Z',
        insuranceNumber: 'INS123',
        insuranceExpiry: '2026-12-31T00:00:00.000Z'
      }, {
        headers: { Authorization: `Bearer ${driverToken}` }
      });
      
      console.log('✅ Driver profile created:', createProfileResponse.data);
    } catch (error) {
      console.log('❌ Could not create driver profile:', error.response?.data || error.message);
    }
    
    // Step 4: Try to approve all drivers
    console.log('\n4. Approving all drivers...');
    try {
      const approveResponse = await axios.post(`${BASE_URL}/api/drivers/approve-all`, {}, {
        headers: { Authorization: `Bearer ${driverToken}` }
      });
      
      console.log('✅ Drivers approved:', approveResponse.data);
    } catch (error) {
      console.log('❌ Could not approve drivers:', error.response?.data || error.message);
    }
    
    // Step 5: Update driver location
    console.log('\n5. Updating driver location...');
    try {
      const locationResponse = await axios.post(`${BASE_URL}/api/drivers/location`, {
        latitude: 35.9208,
        longitude: 74.3144
      }, {
        headers: { Authorization: `Bearer ${driverToken}` }
      });
      
      console.log('✅ Driver location updated:', locationResponse.data);
    } catch (error) {
      console.log('❌ Could not update driver location:', error.response?.data || error.message);
    }
    
    // Step 6: Check debug drivers endpoint
    console.log('\n6. Checking debug drivers...');
    try {
      const debugResponse = await axios.get(`${BASE_URL}/api/ride-requests/debug-drivers`, {
        headers: { Authorization: `Bearer ${driverToken}` }
      });
      
      console.log('✅ Debug drivers info:', debugResponse.data);
    } catch (error) {
      console.log('❌ Could not get debug drivers:', error.response?.data || error.message);
    }
    
    // Step 7: Test ride request creation
    console.log('\n7. Testing ride request creation...');
    try {
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
        headers: { Authorization: `Bearer ${driverToken}` }
      });
      
      console.log('✅ Ride request created:', rideRequestResponse.data);
    } catch (error) {
      console.log('❌ Could not create ride request:', error.response?.data || error.message);
    }
    
    // Step 8: Check available ride requests
    console.log('\n8. Checking available ride requests...');
    try {
      const requestsResponse = await axios.get(`${BASE_URL}/api/ride-requests/available-simple`, {
        headers: { Authorization: `Bearer ${driverToken}` }
      });
      
      console.log('✅ Available ride requests:', requestsResponse.data.rideRequests.length);
      if (requestsResponse.data.rideRequests.length > 0) {
        console.log('🎉 SUCCESS! Driver can see ride requests!');
      } else {
        console.log('❌ Driver cannot see any ride requests');
      }
    } catch (error) {
      console.log('❌ Could not get available requests:', error.response?.data || error.message);
    }
    
  } catch (error) {
    console.error('❌ Fix failed:', error.response?.data || error.message);
  }
}

fixDeployedServer();
