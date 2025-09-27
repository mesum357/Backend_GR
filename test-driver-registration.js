const fetch = require('node-fetch').default;

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function testDriverRegistration() {
  try {
    console.log('🧪 Testing driver registration check...');
    
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
    
    // Step 2: Test driver registration check
    console.log('\n2. Testing driver registration check...');
    const registrationResponse = await fetch(`${BASE_URL}/api/drivers/check-registration`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      }
    });
    
    console.log('📊 Registration check response status:', registrationResponse.status);
    
    if (registrationResponse.ok) {
      const registrationData = await registrationResponse.json();
      console.log('✅ Registration check data:', registrationData);
      console.log(`📈 Is registered: ${registrationData.isRegistered}`);
      console.log(`📈 Is approved: ${registrationData.isApproved}`);
      console.log(`📈 Is verified: ${registrationData.isVerified}`);
      console.log(`📈 Driver profile:`, registrationData.driverProfile);
    } else {
      const errorData = await registrationResponse.json();
      console.log('❌ Registration check error:', errorData);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testDriverRegistration();
