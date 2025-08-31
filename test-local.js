const http = require('http');

function testLocal() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 8080,
      path: '/api/health',
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({ status: res.statusCode, data });
        } catch (error) {
          resolve({ status: res.statusCode, data: { raw: body } });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function runTest() {
  console.log('🔍 Testing local server...');
  
  try {
    const result = await testLocal();
    console.log(`✅ Server is working! Status: ${result.status}`);
    console.log(`Response: ${JSON.stringify(result.data)}`);
    
    console.log('\n📱 For React Native app, try these URLs:');
    console.log('1. http://192.168.1.14:8080/api/auth/register');
    console.log('2. http://192.168.1.14:8080/api/auth/login');
    
    console.log('\n🔧 If connection fails, run the firewall fix:');
    console.log('PowerShell as Administrator: .\\fix-firewall.ps1');
    
  } catch (error) {
    console.log(`❌ Server test failed: ${error.message}`);
    console.log('Make sure the server is running with: node server.js');
  }
}

runTest();
