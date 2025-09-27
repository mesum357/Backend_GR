const fetch = require('node-fetch').default;

const BASE_URL = 'http://192.168.137.1:8080';

async function createTestRider() {
  try {
    console.log('🧪 Creating test rider account...');
    
    // Register a new rider
    const registerResponse = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'testrider@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'Rider',
        phone: '1234567890',
        userType: 'rider'
      })
    });
    
    const registerData = await registerResponse.json();
    console.log('📊 Registration response status:', registerResponse.status);
    console.log('📊 Registration response:', registerData);
    
    if (registerResponse.ok) {
      console.log('✅ Rider account created successfully');
      
      // Now test login
      console.log('\n🔍 Testing login...');
      const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'testrider@example.com',
          password: 'password123',
          expectedUserType: 'rider'
        })
      });
      
      const loginData = await loginResponse.json();
      console.log('📊 Login response status:', loginResponse.status);
      console.log('📊 Login response:', loginData);
      
      if (loginResponse.ok) {
        console.log('✅ Rider login successful');
        return loginData.token;
      } else {
        console.log('❌ Rider login failed');
      }
    } else {
      console.log('❌ Rider registration failed');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

createTestRider();
