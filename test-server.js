const express = require('express');
const cors = require('cors');

const app = express();

// Enable CORS for all origins
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json());

// Simple health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Test server is running',
    timestamp: new Date().toISOString(),
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
});

// Test registration endpoint
app.post('/api/auth/register', (req, res) => {
  console.log('Registration request received:', req.body);
  res.json({ 
    success: true, 
    message: 'Test registration endpoint working',
    data: req.body
  });
});

const PORT = 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Test server running on port ${PORT}`);
  console.log(`🌐 Server accessible at:`);
  console.log(`   - Local: http://localhost:${PORT}`);
  console.log(`   - Network: http://192.168.0.222:${PORT}`);
  console.log(`   - All interfaces: 0.0.0.0:${PORT}`);
  console.log(`📡 Health check: http://192.168.0.222:${PORT}/api/health`);
});

