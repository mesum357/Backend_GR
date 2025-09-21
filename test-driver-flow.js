const axios = require('axios');

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function testDriverFlow() {
  try {
    console.log('🧪 Testing driver flow...');
    
    // Step 1: Register a new driver
    console.log('\n1. Registering new driver...');
    const registerResponse = await axios.post(`${BASE_URL}/api/auth/register`, {
      firstName: 'Test',
      lastName: 'Driver',
      email: `testdriver${Date.now()}@example.com`,
      phone: `123456${Date.now().toString().slice(-4)}`,
      password: '123456',
      userType: 'driver',
      driverInfo: {
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
      }
    });
    
    console.log('✅ Driver registered:', registerResponse.data.user.email);
    const token = registerResponse.data.token;
    
    // Step 2: Check driver registration
    console.log('\n2. Checking driver registration...');
    const checkResponse = await axios.get(`${BASE_URL}/api/drivers/check-registration`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('✅ Driver registration status:', checkResponse.data);
    
    // Step 2.5: Create driver profile if needed
    if (!checkResponse.data.driverProfile || checkResponse.data.driverProfile.userType === 'driver') {
      console.log('\n2.5. Creating driver profile...');
      const createProfileResponse = await axios.post(`${BASE_URL}/api/drivers/create-profile`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      console.log('✅ Driver profile created:', createProfileResponse.data);
    }
    
    // Step 3: Update driver location
    console.log('\n3. Updating driver location...');
    const locationResponse = await axios.post(`${BASE_URL}/api/drivers/location`, {
      latitude: 35.9208,
      longitude: 74.3144
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('✅ Driver location updated:', locationResponse.data);
    
    // Step 4: Check available ride requests
    console.log('\n4. Checking available ride requests...');
    const requestsResponse = await axios.get(`${BASE_URL}/api/ride-requests/available-simple`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('✅ Available ride requests:', requestsResponse.data.rideRequests.length);
    
    // Step 5: Create a test ride request (as rider)
    console.log('\n5. Creating test ride request...');
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
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('✅ Ride request created:', rideRequestResponse.data);
    
    // Step 6: Check if driver can see the request
    console.log('\n6. Checking if driver can see the request...');
    const driverRequestsResponse = await axios.get(`${BASE_URL}/api/ride-requests/available-simple`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('✅ Driver sees requests:', driverRequestsResponse.data.rideRequests.length);
    
    console.log('\n🎉 Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testDriverFlow();
