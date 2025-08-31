const express = require('express');
const cors = require('cors');

const app = express();

// Enable CORS for all origins
app.use(cors());
app.use(express.json());

// Simple health check
app.get('/api/health', (req, res) => {
  console.log('Health check requested');
  res.json({ status: 'OK', message: 'Server is running' });
});

// Simple registration endpoint
app.post('/api/auth/register', (req, res) => {
  console.log('Registration requested:', req.body);
  res.json({ 
    message: 'Registration successful', 
    user: req.body,
    token: 'test-token-123'
  });
});

const PORT = 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ Health: http://localhost:${PORT}/api/health`);
  console.log(`✅ Register: http://localhost:${PORT}/api/auth/register`);
});
