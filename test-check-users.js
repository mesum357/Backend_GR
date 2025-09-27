const fetch = require('node-fetch').default;

const BASE_URL = 'http://192.168.137.1:8080';

async function checkUsers() {
  try {
    console.log('🧪 Checking existing users...');
    
    // Try to login with different test accounts
    const testAccounts = [
      { email: 'testrider@example.com', password: 'password123', userType: 'rider' },
      { email: 'mesum@gmail.com', password: 'password123', userType: 'rider' },
      { email: 'testdriver@example.com', password: 'password123', userType: 'driver' },
      { email: 'rider@example.com', password: 'password123', userType: 'rider' }
    ];
    
    for (const account of testAccounts) {
      console.log(`\n🔍 Trying ${account.email}...`);
      
      const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: account.email,
          password: account.password,
          expectedUserType: account.userType
        })
      });
      
      const loginData = await loginResponse.json();
      
      if (loginResponse.ok) {
        console.log(`✅ ${account.email} login successful:`, {
          userType: loginData.user.userType,
          firstName: loginData.user.firstName,
          lastName: loginData.user.lastName
        });
      } else {
        console.log(`❌ ${account.email} login failed:`, loginData.error);
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

checkUsers();
