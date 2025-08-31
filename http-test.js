const http = require('http');

// Test health endpoint
function testHealth() {
  console.log('🧪 Testing health endpoint...');
  
  const options = {
    hostname: 'localhost',
    port: 8080,
    path: '/api/health',
    method: 'GET'
  };

  const req = http.request(options, (res) => {
    console.log(`✅ Health Status: ${res.statusCode}`);
    
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log('✅ Health Response:', data);
      testRegistration();
    });
  });

  req.on('error', (error) => {
    console.error('❌ Health test failed:', error.message);
  });

  req.end();
}

// Test registration endpoint
function testRegistration() {
  console.log('\n🧪 Testing registration endpoint...');
  
  const postData = JSON.stringify({
    firstName: 'Test',
    lastName: 'User',
    email: 'test@example.com',
    phone: '1234567890',
    password: 'password123',
    userType: 'rider'
  });

  const options = {
    hostname: 'localhost',
    port: 8080,
    path: '/api/auth/register',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = http.request(options, (res) => {
    console.log(`✅ Registration Status: ${res.statusCode}`);
    
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log('✅ Registration Response:', data);
    });
  });

  req.on('error', (error) => {
    console.error('❌ Registration test failed:', error.message);
  });

  req.write(postData);
  req.end();
}

// Start tests
testHealth();

