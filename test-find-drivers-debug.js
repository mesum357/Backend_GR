const axios = require('axios');

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function testFindDriversDebug() {
  try {
    console.log('🔍 Testing findDriversWithinRadius function directly...');
    
    // Step 1: Login as driver
    console.log('\n1. Logging in as driver...');
    const driverLoginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: 'samran@gandu.com',
      password: '123456',
      expectedUserType: 'driver'
    });
    
    console.log('✅ Driver logged in:', driverLoginResponse.data.user.email);
    const driverToken = driverLoginResponse.data.token;
    
    // Step 2: Set driver online
    console.log('\n2. Setting driver online...');
    const toggleResponse = await axios.post(`${BASE_URL}/api/drivers/toggle-status`, {}, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver status toggle response:', toggleResponse.data);
    
    // Step 3: Update driver location
    console.log('\n3. Updating driver location...');
    const locationResponse = await axios.post(`${BASE_URL}/api/drivers/location`, {
      latitude: 35.91123052970746,
      longitude: 74.34989800233608
    }, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver location updated:', locationResponse.data);
    
    // Step 4: Test findDriversWithinRadius function directly
    console.log('\n4. Testing findDriversWithinRadius function...');
    const debugResponse = await axios.get(`${BASE_URL}/api/ride-requests/debug-find-drivers?latitude=35.911263&longitude=74.3501778&radius=5`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ findDriversWithinRadius debug response:', debugResponse.data);
    
    // Step 5: Test with exact driver coordinates
    console.log('\n5. Testing with exact driver coordinates...');
    const debugResponse2 = await axios.get(`${BASE_URL}/api/ride-requests/debug-find-drivers?latitude=35.91123052970746&longitude=74.34989800233608&radius=1`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ findDriversWithinRadius debug response (exact coords):', debugResponse2.data);
    
    // Step 6: Test with very large radius
    console.log('\n6. Testing with very large radius...');
    const debugResponse3 = await axios.get(`${BASE_URL}/api/ride-requests/debug-find-drivers?latitude=35.911263&longitude=74.3501778&radius=100`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ findDriversWithinRadius debug response (large radius):', debugResponse3.data);
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testFindDriversDebug();
