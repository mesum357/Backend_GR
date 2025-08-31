const http = require('http');

function testConnection(host, port, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      port: port,
      path: path,
      method: 'GET',
      timeout: 5000
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

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

async function testNetworkAccess() {
  console.log('🌐 Testing Network Access...\n');

  const tests = [
    { name: 'Localhost', host: 'localhost', port: 8080, path: '/api/health' },
    { name: 'Network IP', host: '192.168.1.14', port: 8080, path: '/api/health' },
    { name: '0.0.0.0', host: '0.0.0.0', port: 8080, path: '/api/health' }
  ];

  for (const test of tests) {
    console.log(`Testing ${test.name} (${test.host}:${test.port})...`);
    try {
      const result = await testConnection(test.host, test.port, test.path);
      console.log(`   ✅ Success: ${result.status} - ${result.data.message || 'Connected'}`);
    } catch (error) {
      console.log(`   ❌ Failed: ${error.message}`);
    }
    console.log('');
  }

  console.log('🔧 Troubleshooting Tips:');
  console.log('1. Make sure Windows Firewall allows Node.js on port 8080');
  console.log('2. Check if your antivirus is blocking the connection');
  console.log('3. Try running the server with administrator privileges');
  console.log('4. Verify the IP address is correct for your network');
}

testNetworkAccess().catch(console.error);
