const http = require('http');

// Test different IP addresses
const testUrls = [
  'http://localhost:8080/api/health',
  'http://127.0.0.1:8080/api/health',
  'http://192.168.1.14:8080/api/health'
];

async function testConnection(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        console.log(`✅ ${url}: ${res.statusCode} - ${data}`);
        resolve(true);
      });
    });

    req.on('error', (error) => {
      console.log(`❌ ${url}: ${error.message}`);
      resolve(false);
    });

    req.setTimeout(5000, () => {
      console.log(`⏰ ${url}: Timeout`);
      req.destroy();
      resolve(false);
    });
  });
}

async function runTests() {
  console.log('🧪 Testing server connections...\n');
  
  for (const url of testUrls) {
    await testConnection(url);
  }
  
  console.log('\n📋 Summary:');
  console.log('- If localhost works but 192.168.1.14 doesn\'t: Firewall issue');
  console.log('- If none work: Server not running');
  console.log('- If all work: Ready for mobile app!');
}

runTests();
