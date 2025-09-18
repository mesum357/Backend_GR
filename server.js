const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const passport = require('passport');
const session = require('express-session');
const http = require('http');
const socketIo = require('socket.io');
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
const fareOfferRoutes = require('./routes/fare-offers');

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/firebase', firebaseRoutes);
app.use('/api/ride-requests', rideRequestRoutes);
app.use('/api/firebase-auth', firebaseAuthRoutes);
app.use('/api/driver/wallet', driverWalletRoutes);
app.use('/api/fare-offers', fareOfferRoutes);

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

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Store active connections
const activeConnections = new Map(); // userId -> socketId
const driverConnections = new Map(); // driverId -> socketId

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`🔌 New connection: ${socket.id}`);

  // Handle user authentication
  socket.on('authenticate', (data) => {
    const { userId, userType } = data;
    activeConnections.set(userId, socket.id);
    
    if (userType === 'driver') {
      driverConnections.set(userId, socket.id);
      console.log(`🚗 Driver ${userId} connected`);
    } else {
      console.log(`👤 Rider ${userId} connected`);
    }
  });

  // Handle driver response to ride request
  socket.on('driver_response', async (data) => {
    try {
      const { rideRequestId, driverId, action, counterOffer } = data;
      
      // Find the ride request
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId);
      
      if (!rideRequest) {
        socket.emit('error', { message: 'Ride request not found' });
        return;
      }

      if (action === 'accept') {
        // Atomic assignment - only first accept wins
        if (rideRequest.status === 'pending') {
          rideRequest.status = 'accepted';
          rideRequest.acceptedBy = driverId;
          await rideRequest.save();

          // Notify rider
          const riderSocketId = activeConnections.get(rideRequest.rider.toString());
          if (riderSocketId) {
            io.to(riderSocketId).emit('driver_assigned', {
              rideRequestId,
              driverId,
              message: 'Driver has been assigned to your ride'
            });
          }

          // Notify all other drivers that request is no longer available
          rideRequest.availableDrivers.forEach(availableDriver => {
            if (availableDriver.driver.toString() !== driverId) {
              const driverSocketId = driverConnections.get(availableDriver.driver.toString());
              if (driverSocketId) {
                io.to(driverSocketId).emit('ride_request_cancelled', {
                  rideRequestId,
                  message: 'This ride request has been accepted by another driver'
                });
              }
            }
          });

          socket.emit('response_success', { message: 'Ride request accepted successfully' });
        } else {
          socket.emit('error', { message: 'Ride request is no longer available' });
        }
      } else if (action === 'negotiate') {
        // Handle counter offer
        rideRequest.availableDrivers.forEach(availableDriver => {
          if (availableDriver.driver.toString() === driverId) {
            availableDriver.counterOffer = counterOffer;
            availableDriver.status = 'counter_offered';
            availableDriver.respondedAt = new Date();
          }
        });
        
        await rideRequest.save();

        // Notify rider about counter offer
        const riderSocketId = activeConnections.get(rideRequest.rider.toString());
        if (riderSocketId) {
          io.to(riderSocketId).emit('ride_counter_offer', {
            rideRequestId,
            driverId,
            counterOffer,
            message: 'Driver has made a counter offer'
          });
        }

        socket.emit('response_success', { message: 'Counter offer sent successfully' });
      }
    } catch (error) {
      console.error('Error handling driver response:', error);
      socket.emit('error', { message: 'Failed to process response' });
    }
  });

  // Handle rider accepting counter offer
  socket.on('accept_counter_offer', async (data) => {
    try {
      const { rideRequestId, driverId } = data;
      
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId);
      
      if (!rideRequest) {
        socket.emit('error', { message: 'Ride request not found' });
        return;
      }

      // Find the counter offer
      const counterOfferDriver = rideRequest.availableDrivers.find(
        driver => driver.driver.toString() === driverId && driver.status === 'counter_offered'
      );

      if (!counterOfferDriver) {
        socket.emit('error', { message: 'Counter offer not found' });
        return;
      }

      // Accept the counter offer
      rideRequest.status = 'accepted';
      rideRequest.acceptedBy = driverId;
      rideRequest.requestedPrice = counterOfferDriver.counterOffer;
      await rideRequest.save();

      // Notify driver
      const driverSocketId = driverConnections.get(driverId);
      if (driverSocketId) {
        io.to(driverSocketId).emit('counter_offer_accepted', {
          rideRequestId,
          message: 'Your counter offer has been accepted'
        });
      }

      // Notify rider
      socket.emit('counter_offer_accepted', {
        rideRequestId,
        message: 'Counter offer accepted successfully'
      });

      // Notify other drivers
      rideRequest.availableDrivers.forEach(availableDriver => {
        if (availableDriver.driver.toString() !== driverId) {
          const driverSocketId = driverConnections.get(availableDriver.driver.toString());
          if (driverSocketId) {
            io.to(driverSocketId).emit('ride_request_cancelled', {
              rideRequestId,
              message: 'This ride request has been accepted by another driver'
            });
          }
        }
      });

    } catch (error) {
      console.error('Error accepting counter offer:', error);
      socket.emit('error', { message: 'Failed to accept counter offer' });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`🔌 Disconnected: ${socket.id}`);
    
    // Remove from active connections
    for (const [userId, socketId] of activeConnections.entries()) {
      if (socketId === socket.id) {
        activeConnections.delete(userId);
        driverConnections.delete(userId);
        console.log(`👤 User ${userId} disconnected`);
        break;
      }
    }
  });
});

// Make io and connection maps available to routes
app.set('io', io);
app.set('activeConnections', activeConnections);
app.set('driverConnections', driverConnections);

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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Server accessible at:`);
  console.log(`  - Local: http://localhost:${PORT}`);
  console.log(`  - Network: http://${networkIP}:${PORT}`);
  console.log(`  - All interfaces: 0.0.0.0:${PORT}`);
});
