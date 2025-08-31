const http = require('http');

// Test different ports
const ports = [8080, 3000, 5000, 8081];

async function testPort(port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `Server running on port ${port}` }));
    });

    server.listen(port, '0.0.0.0', () => {
      console.log(`✅ Port ${port} is available and server started`);
      server.close(() => {
        console.log(`✅ Port ${port} test completed`);
        resolve(true);
      });
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.log(`❌ Port ${port} is already in use`);
      } else {
        console.log(`❌ Port ${port} error: ${error.message}`);
      }
      resolve(false);
    });
  });
}

async function runPortTests() {
  console.log('🧪 Testing available ports...\n');
  
  for (const port of ports) {
    await testPort(port);
  }
  
  console.log('\n📋 Available ports for your server:');
  console.log('- Try starting server on an available port');
}

runPortTests();
