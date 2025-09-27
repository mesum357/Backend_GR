const http = require('http');

// Test localhost backend connectivity
function testLocalhostBackend() {
  console.log('🧪 Testing localhost backend connectivity...\n');
  
  const options = {
    hostname: 'localhost',
    port: 8080,
    path: '/api/health',
    method: 'GET',
    timeout: 5000
  };

  const req = http.request(options, (res) => {
    console.log(`✅ Backend is running! Status: ${res.statusCode}`);
    console.log(`📊 Response headers:`, res.headers);
    
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log('📄 Response body:', data);
      
      try {
        const response = JSON.parse(data);
        if (response.status === 'OK') {
          console.log('🎉 Backend is healthy and ready!');
          console.log('📱 Mobile devices can now connect to this backend.');
        } else {
          console.log('⚠️ Backend responded but status is not OK');
        }
      } catch (error) {
        console.log('⚠️ Could not parse response as JSON');
      }
    });
  });

  req.on('error', (error) => {
    console.error('❌ Backend connection failed:', error.message);
    console.log('\n💡 Make sure the backend is running:');
    console.log('   - Run: node server.js');
    console.log('   - Or: npm start');
    console.log('   - Or: npm run local');
  });

  req.on('timeout', () => {
    console.error('❌ Request timed out');
    console.log('💡 Backend might be starting up or not responding');
    req.destroy();
  });

  req.end();
}

// Test network IP connectivity
function testNetworkIP() {
  const os = require('os');
  
  function getNetworkIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const interface of interfaces[name]) {
        if (interface.family === 'IPv4' && !interface.internal) {
          return interface.address;
        }
      }
    }
    return 'localhost';
  }
  
  const networkIP = getNetworkIP();
  console.log(`\n🌐 Testing network IP: ${networkIP}`);
  
  const options = {
    hostname: networkIP,
    port: 8080,
    path: '/api/health',
    method: 'GET',
    timeout: 5000
  };

  const req = http.request(options, (res) => {
    console.log(`✅ Network access working! Status: ${res.statusCode}`);
    console.log(`📱 Mobile devices can connect to: http://${networkIP}:8080`);
  });

  req.on('error', (error) => {
    console.error('❌ Network access failed:', error.message);
    console.log('💡 Check firewall settings or network configuration');
  });

  req.on('timeout', () => {
    console.error('❌ Network request timed out');
    req.destroy();
  });

  req.end();
}

// Run tests
console.log('🔍 Backend Connectivity Test\n');
testLocalhostBackend();

// Test network IP after a short delay
setTimeout(() => {
  testNetworkIP();
}, 1000);

