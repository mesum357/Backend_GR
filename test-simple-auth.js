const http = require('http');

function makeRequest(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: `/api${path}`,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(body);
          resolve({ status: res.statusCode, data: jsonData });
        } catch (error) {
          resolve({ status: res.statusCode, data: { raw: body } });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function testSimpleAuth() {
  console.log('🔐 Simple Authentication Test...\n');

  // Test 1: Health check
  console.log('1. Testing health check...');
  try {
    const response = await makeRequest('/health');
    console.log(`   Status: ${response.status}`);
    console.log(`   Response: ${JSON.stringify(response.data)}\n`);
  } catch (error) {
    console.log(`   Error: ${error.message}\n`);
  }

  // Test 2: Register a user
  console.log('2. Testing user registration...');
  try {
    const userData = {
      email: `testuser${Date.now()}@example.com`,
      password: 'testpassword123',
      firstName: 'Test',
      lastName: 'User',
      phone: `+92${Math.floor(Math.random() * 9000000000) + 1000000000}`,
      userType: 'rider'
    };

    const response = await makeRequest('/auth/register', 'POST', userData);
    console.log(`   Status: ${response.status}`);
    console.log(`   Response: ${JSON.stringify(response.data)}\n`);
  } catch (error) {
    console.log(`   Error: ${error.message}\n`);
  }

  // Test 3: Login with the same user
  console.log('3. Testing user login...');
  try {
    const loginData = {
      email: 'testuser@example.com', // Use a known email
      password: 'testpassword123'
    };

    const response = await makeRequest('/auth/login', 'POST', loginData);
    console.log(`   Status: ${response.status}`);
    console.log(`   Response: ${JSON.stringify(response.data)}\n`);
  } catch (error) {
    console.log(`   Error: ${error.message}\n`);
  }

  console.log('✅ Simple authentication test completed!');
}

testSimpleAuth().catch(console.error);
