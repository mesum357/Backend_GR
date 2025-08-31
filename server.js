const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const passport = require('passport');
const session = require('express-session');
require('dotenv').config();

// Import passport configuration
require('./config/passport');

// Import Firebase configuration
const firebase = require('./config/firebase');

const app = express();

// Middleware
app.use(cors({
  origin: true, // Allow all origins in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration (only for web clients, not React Native)
if (process.env.NODE_ENV !== 'react-native') {
  app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }));
}

// Passport middleware (only for web clients, not React Native)
if (process.env.NODE_ENV !== 'react-native') {
  app.use(passport.initialize());
  app.use(passport.session());
}

// Database connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/tourist_app';
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const rideRoutes = require('./routes/rides');
const driverRoutes = require('./routes/drivers');
const firebaseRoutes = require('./routes/firebase');
const rideRequestRoutes = require('./routes/ride-requests');
const firebaseAuthRoutes = require('./routes/firebase-auth');
const driverWalletRoutes = require('./routes/driverWallet');

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/firebase', firebaseRoutes);
app.use('/api/ride-requests', rideRequestRoutes);
app.use('/api/firebase-auth', firebaseAuthRoutes);
app.use('/api/driver/wallet', driverWalletRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    firebase: firebase.admin ? 'Initialized' : 'Not configured'
  });
});

// Firebase endpoints
app.get('/api/firebase/status', (req, res) => {
  res.json({
    firebase: firebase.admin ? 'Initialized' : 'Not configured',
    auth: firebase.auth ? 'Available' : 'Not available',
    firestore: firebase.firestore ? 'Available' : 'Not available',
    storage: firebase.storage ? 'Available' : 'Not available'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 8080;

// Get network IP address
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Server accessible at:`);
  console.log(`  - Local: http://localhost:${PORT}`);
  console.log(`  - Network: http://${networkIP}:${PORT}`);
  console.log(`  - All interfaces: 0.0.0.0:${PORT}`);
});
