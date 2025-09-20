const fetch = require('node-fetch').default;

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function testDriverAuth() {
  try {
    console.log('🧪 Testing driver authentication...');
    
    // Step 1: Login as driver
    console.log('\n1. Logging in as driver...');
    const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'testdriver@example.com',
        password: 'password123',
        expectedUserType: 'driver'
      })
    });
    
    const loginData = await loginResponse.json();
    console.log('✅ Driver login response:', loginData);
    
    if (!loginResponse.ok) {
      throw new Error('Driver login failed');
    }
    
    const token = loginData.token;
    
    // Step 2: Test profile endpoint
    console.log('\n2. Testing profile endpoint...');
    const profileResponse = await fetch(`${BASE_URL}/api/auth/profile`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      }
    });
    
    console.log('📊 Profile response status:', profileResponse.status);
    
    if (profileResponse.ok) {
      const profileData = await profileResponse.json();
      console.log('✅ Profile data:', profileData);
    } else {
      const errorData = await profileResponse.json();
      console.log('❌ Profile error:', errorData);
    }
    
    // Step 3: Test ride requests endpoint
    console.log('\n3. Testing ride requests endpoint...');
    const rideRequestsResponse = await fetch(`${BASE_URL}/api/ride-requests/available-simple`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      }
    });
    
    console.log('📊 Ride requests response status:', rideRequestsResponse.status);
    
    if (rideRequestsResponse.ok) {
      const rideRequestsData = await rideRequestsResponse.json();
      console.log('✅ Ride requests data:', rideRequestsData);
      console.log(`📈 Found ${rideRequestsData.total || 0} ride requests`);
    } else {
      const errorData = await rideRequestsResponse.json();
      console.log('❌ Ride requests error:', errorData);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testDriverAuth();
