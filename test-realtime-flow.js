const axios = require('axios');

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function testRealtimeFlow() {
  try {
    console.log('🧪 Testing real-time ride request flow...');
    
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
    const driverToken = registerResponse.data.token;
    
    // Step 2: Register a new rider
    console.log('\n2. Registering new rider...');
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
    
    // Step 3: Check driver registration and create profile if needed
    console.log('\n3. Checking driver registration...');
    const checkResponse = await axios.get(`${BASE_URL}/api/drivers/check-registration`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver registration status:', checkResponse.data);
    
    // Step 4: Update driver location
    console.log('\n4. Updating driver location...');
    const locationResponse = await axios.post(`${BASE_URL}/api/drivers/location`, {
      latitude: 35.9208,
      longitude: 74.3144
    }, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver location updated:', locationResponse.data);
    
    // Step 5: Check available ride requests (should be 0 initially)
    console.log('\n5. Checking available ride requests...');
    const requestsResponse = await axios.get(`${BASE_URL}/api/ride-requests/available-simple`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Available ride requests:', requestsResponse.data.rideRequests.length);
    
    // Step 6: Create a test ride request
    console.log('\n6. Creating test ride request...');
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
    
    // Step 7: Check if driver can see the request
    console.log('\n7. Checking if driver can see the request...');
    const driverRequestsResponse = await axios.get(`${BASE_URL}/api/ride-requests/available-simple`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver sees requests:', driverRequestsResponse.data.rideRequests.length);
    
    if (driverRequestsResponse.data.rideRequests.length > 0) {
      console.log('🎉 SUCCESS! Real-time ride request flow is working!');
      console.log('📋 Request details:', driverRequestsResponse.data.rideRequests[0]);
    } else {
      console.log('❌ FAILED! Driver cannot see the ride request');
    }
    
    // Step 8: Test WebSocket connection (simulate driver listening)
    console.log('\n8. Testing WebSocket connection...');
    console.log('ℹ️  WebSocket testing requires a real client connection');
    console.log('ℹ️  The driver app should now receive real-time notifications');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testRealtimeFlow();
