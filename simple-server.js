const http = require('http');
const url = require('url');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// In-memory storage
const users = [];
const JWT_SECRET = 'your-jwt-secret-key';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

// Parse JSON body
function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        resolve({});
      }
    });
  });
}

// Create server
const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;

  console.log(`📥 ${req.method} ${path} from ${req.socket.remoteAddress}`);

  try {
    // Health check endpoint
    if (path === '/api/health' && req.method === 'GET') {
      res.writeHead(200, corsHeaders);
      res.end(JSON.stringify({ status: 'OK', message: 'Server is running' }));
      return;
    }

    // Registration endpoint
    if (path === '/api/auth/register' && req.method === 'POST') {
      const body = await parseBody(req);
      console.log('📥 Registration body:', body);

      const { firstName, lastName, email, phone, password, userType } = body;

      // Check if user already exists
      const existingUser = users.find(user => user.email === email);
      if (existingUser) {
        res.writeHead(400, corsHeaders);
        res.end(JSON.stringify({ error: 'User already exists' }));
        return;
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user object
      const user = {
        _id: Date.now().toString(),
        firstName,
        lastName,
        email: email.toLowerCase(),
        phone,
        userType,
        password: hashedPassword,
        rating: 0,
        totalRides: 0,
        wallet: { balance: 0, currency: 'PKR' },
        isOnline: false,
        isVerified: false,
        createdAt: new Date()
      };

      // Add to users array
      users.push(user);

      // Generate JWT token
      const token = jwt.sign(
        { userId: user._id, email: user.email },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      // Return user data without password
      const { password: _, ...userWithoutPassword } = user;

      res.writeHead(201, corsHeaders);
      res.end(JSON.stringify({
        message: 'User registered successfully',
        token,
        user: userWithoutPassword
      }));
      return;
    }

    // Login endpoint
    if (path === '/api/auth/login' && req.method === 'POST') {
      const body = await parseBody(req);
      console.log('📥 Login body:', body);

      const { email, password } = body;

      // Find user
      const user = users.find(u => u.email === email.toLowerCase());
      if (!user) {
        res.writeHead(401, corsHeaders);
        res.end(JSON.stringify({ error: 'Invalid credentials' }));
        return;
      }

      // Check password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        res.writeHead(401, corsHeaders);
        res.end(JSON.stringify({ error: 'Invalid credentials' }));
        return;
      }

      // Generate JWT token
      const token = jwt.sign(
        { userId: user._id, email: user.email },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      // Return user data without password
      const { password: _, ...userWithoutPassword } = user;

      res.writeHead(200, corsHeaders);
      res.end(JSON.stringify({
        message: 'Login successful',
        token,
        user: userWithoutPassword
      }));
      return;
    }

    // Test endpoint
    if (path === '/api/test' && req.method === 'GET') {
      res.writeHead(200, corsHeaders);
      res.end(JSON.stringify({ message: 'API is working!', users: users.length }));
      return;
    }

    // 404 for unknown endpoints
    res.writeHead(404, corsHeaders);
    res.end(JSON.stringify({ error: 'Endpoint not found' }));

  } catch (error) {
    console.error('❌ Server error:', error);
    res.writeHead(500, corsHeaders);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

// Start server
const PORT = 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Simple server running on port ${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
  console.log(`✅ Register: http://localhost:${PORT}/api/auth/register`);
  console.log(`✅ Login: http://localhost:${PORT}/api/auth/login`);
  console.log(`✅ Test: http://localhost:${PORT}/api/test`);
});

// Handle server errors
server.on('error', (error) => {
  console.error('❌ Server error:', error);
});

