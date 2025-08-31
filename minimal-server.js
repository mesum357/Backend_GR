const http = require('http');

// Simple server
const server = http.createServer((req, res) => {
  console.log(`📥 ${req.method} ${req.url} from ${req.socket.remoteAddress}`);
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // Health endpoint
  if (req.url === '/api/health' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'OK', message: 'Server is running!' }));
    return;
  }
  
  // Test endpoint
  if (req.url === '/api/test' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ message: 'Test successful!', timestamp: new Date().toISOString() }));
    return;
  }
  
  // Default response
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Start server
const PORT = 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Minimal server running on port ${PORT}`);
  console.log(`✅ Health: http://localhost:${PORT}/api/health`);
  console.log(`✅ Test: http://localhost:${PORT}/api/test`);
  console.log(`✅ Network: http://192.168.1.14:${PORT}/api/health`);
});

// Error handling
server.on('error', (error) => {
  console.error('❌ Server error:', error);
});
