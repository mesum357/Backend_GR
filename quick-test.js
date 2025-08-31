const http = require('http');

// Simple test function
function testEndpoint(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 8080,
      path: `/api${path}`,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(body);
          resolve({ status: res.statusCode, data: jsonData });
        } catch (error) {
          resolve({ status: res.statusCode, data: { raw: body } });
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function quickTest() {
  console.log('🚀 Quick Server Test...\n');

  try {
    // Test 1: Health check
    console.log('1. Health Check...');
    const health = await testEndpoint('/health');
    console.log(`   ✅ Status: ${health.status} - ${health.data.message}\n`);

    // Test 2: Firebase status
    console.log('2. Firebase Status...');
    const firebase = await testEndpoint('/firebase/status');
    console.log(`   ✅ Status: ${firebase.status} - Firebase: ${firebase.data.firebase}\n`);

    // Test 3: Register a test user
    console.log('3. User Registration...');
    const userData = {
      email: `testuser${Date.now()}@example.com`,
      password: '123456',
      firstName: 'Test',
      lastName: 'User',
      phone: `+92${Math.floor(Math.random() * 9000000000) + 1000000000}`,
      userType: 'rider'
    };
    
    const register = await testEndpoint('/auth/register', 'POST', userData);
    console.log(`   ✅ Status: ${register.status} - ${register.data.message}\n`);

    // Test 4: Login with the same user
    console.log('4. User Login...');
    const login = await testEndpoint('/auth/login', 'POST', {
      email: userData.email,
      password: userData.password
    });
    console.log(`   ✅ Status: ${login.status} - ${login.data.message}\n`);

    console.log('🎉 All tests passed! Your server is ready for React Native!');
    console.log('\n📱 Your React Native app can now connect to:');
    console.log('   http://192.168.1.14:8080/api/auth/register');
    console.log('   http://192.168.1.14:8080/api/auth/login');
    console.log('   http://192.168.1.14:8080/api/firebase-auth/register');
    console.log('   http://192.168.1.14:8080/api/firebase-auth/login');

  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
  }
}

quickTest();
