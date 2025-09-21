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
          // Update status to 'accepted' but don't finalize yet - wait for rider response
          rideRequest.status = 'accepted';
          rideRequest.acceptedBy = driverId;
          rideRequest.acceptedAt = new Date();
          await rideRequest.save();

          // Get driver information for the offer
          const Driver = require('./models/Driver');
          const driver = await Driver.findById(driverId).select('firstName lastName rating vehicleType vehicleModel');
          
          // Calculate arrival time (mock calculation - in real app, use actual distance/time)
          const arrivalTime = Math.floor(Math.random() * 10) + 5; // 5-15 minutes
          
          // Notify rider with fare offer
          const riderSocketId = activeConnections.get(rideRequest.rider.toString());
          if (riderSocketId) {
            io.to(riderSocketId).emit('fare_offer', {
              rideRequestId,
              driverId,
              driverName: driver ? `${driver.firstName} ${driver.lastName}` : 'Driver',
              driverRating: driver ? driver.rating : 4.5,
              fareAmount: counterOffer || rideRequest.offeredFare,
              arrivalTime: arrivalTime,
              vehicleInfo: driver ? `${driver.vehicleType} ${driver.vehicleModel}` : 'Vehicle',
              timestamp: Date.now()
            });
            console.log(`💰 Fare offer sent to rider ${rideRequest.rider} from driver ${driverId}`);
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

          socket.emit('response_success', { 
            message: 'Ride request accepted successfully. Waiting for rider response...',
            rideRequestId,
            waitingForRider: true
          });

          // Set up timeout for rider response (15 seconds) - FIXED
          setTimeout(async () => {
            try {
              // Check if the ride request is still in 'accepted' status (rider hasn't responded)
              const currentRequest = await RideRequest.findById(rideRequestId);
              if (currentRequest && currentRequest.status === 'accepted') {
                // Timeout reached - cancel the acceptance and notify driver
                currentRequest.status = 'cancelled';
                currentRequest.cancelledAt = new Date();
                currentRequest.cancellationReason = 'Rider did not respond within 15 seconds';
                await currentRequest.save();

                // Notify driver about timeout
                const driverSocketId = driverConnections.get(driverId);
                if (driverSocketId) {
                  io.to(driverSocketId).emit('fare_response_timeout', {
                    rideRequestId,
                    message: 'Rider did not respond within 15 seconds. Request cancelled.',
                    action: 'timeout'
                  });
                  console.log(`⏰ Fare offer timeout for ride request ${rideRequestId} - driver ${driverId} notified`);
                }

                // Notify rider about timeout
                if (riderSocketId) {
                  io.to(riderSocketId).emit('fare_offer_timeout', {
                    rideRequestId,
                    message: 'Your response time has expired. Please request a new ride.',
                    action: 'timeout'
                  });
                }
              }
            } catch (timeoutError) {
              console.error('Error handling fare offer timeout:', timeoutError);
            }
          }, 15000); // 15 seconds timeout - FIXED
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

  // Handle fare offer from driver to rider
  socket.on('fare_offer', async (data) => {
    try {
      const { rideRequestId, driverId, driverName, driverRating, fareAmount, arrivalTime, vehicleInfo } = data;
      
      // Find the ride request
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId);
      
      if (!rideRequest) {
        socket.emit('error', { message: 'Ride request not found' });
        return;
      }

      // Add fare offer to ride request
      rideRequest.fareOffers.push({
        driver: driverId,
        driverName,
        driverRating,
        fareAmount,
        arrivalTime,
        vehicleInfo,
        offeredAt: new Date(),
        status: 'pending'
      });

      await rideRequest.save();

      // Notify rider about the fare offer
      const riderSocketId = activeConnections.get(rideRequest.rider.toString());
      if (riderSocketId) {
        io.to(riderSocketId).emit('fare_offer', {
          rideRequestId,
          driverId,
          driverName,
          driverRating,
          fareAmount,
          arrivalTime,
          vehicleInfo
        });
        console.log(`💰 Fare offer sent to rider ${rideRequest.rider} from driver ${driverId}`);
      }

      socket.emit('fare_offer_sent', { message: 'Fare offer sent successfully' });

    } catch (error) {
      console.error('Error handling fare offer:', error);
      socket.emit('error', { message: 'Failed to send fare offer' });
    }
  });

  // Handle rider-initiated ride cancellation and broadcast to drivers
  socket.on('ride_cancelled', async (data) => {
    try {
      const { rideRequestId, userId, userType } = data;
      const RideRequest = require('./models/RideRequest');

      const rideRequest = await RideRequest.findById(rideRequestId);
      if (!rideRequest) {
        socket.emit('error', { message: 'Ride request not found' });
        return;
      }

      // Only allow rider or accepted driver to cancel for safety
      if (userType === 'rider' && rideRequest.rider.toString() !== userId) {
        socket.emit('error', { message: 'Not authorized to cancel this ride request' });
        return;
      }

      // Update status to cancelled
      rideRequest.status = 'cancelled';
      rideRequest.cancelledAt = new Date();
      await rideRequest.save();

      // Notify accepted driver if any
      if (rideRequest.acceptedBy) {
        const acceptedDriverSocketId = driverConnections.get(rideRequest.acceptedBy.toString());
        if (acceptedDriverSocketId) {
          io.to(acceptedDriverSocketId).emit('ride_cancelled', { rideRequestId });
        }
      }

      // Notify all available drivers who saw this request
      if (Array.isArray(rideRequest.availableDrivers)) {
        rideRequest.availableDrivers.forEach((entry) => {
          const driverSocketId = driverConnections.get((entry.driver || '').toString());
          if (driverSocketId) {
            io.to(driverSocketId).emit('ride_cancelled', { rideRequestId });
          }
        });
      }

      // Acknowledge back to requester
      socket.emit('ride_cancelled_ack', { rideRequestId, status: 'ok' });
    } catch (err) {
      console.error('Error handling ride_cancelled event:', err);
      socket.emit('error', { message: 'Failed to cancel ride request' });
    }
  });

  // Handle rider response to fare offer
  socket.on('fare_response', async (data) => {
    try {
      const { rideRequestId, riderId, action } = data;
      
      // Find the ride request
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId);
      
      if (!rideRequest) {
        socket.emit('error', { message: 'Ride request not found' });
        return;
      }

      // Find the latest fare offer
      const latestOffer = rideRequest.fareOffers[rideRequest.fareOffers.length - 1];
      if (!latestOffer || latestOffer.status !== 'pending') {
        socket.emit('error', { message: 'No pending fare offer found' });
        return;
      }

      // Update offer status
      latestOffer.status = action;
      latestOffer.respondedAt = new Date();

      if (action === 'accept') {
        // Update ride request status
        rideRequest.status = 'accepted';
        rideRequest.acceptedBy = latestOffer.driver;
        rideRequest.acceptedAt = new Date();
        
        // Cancel all other pending offers
        rideRequest.fareOffers.forEach(offer => {
          if (offer._id.toString() !== latestOffer._id.toString() && offer.status === 'pending') {
            offer.status = 'rejected';
            offer.respondedAt = new Date();
          }
        });
      }

      await rideRequest.save();

      // Notify driver about the response
      const driverSocketId = activeConnections.get(latestOffer.driver.toString());
      if (driverSocketId) {
        io.to(driverSocketId).emit('fare_response', {
          rideRequestId,
          riderId,
          action,
          timestamp: Date.now()
        });
        console.log(`💰 Fare response sent to driver ${latestOffer.driver} from rider ${riderId}: ${action}`);
      }

      // Notify rider about the response
      const riderSocketId = activeConnections.get(riderId);
      if (riderSocketId) {
        io.to(riderSocketId).emit('fare_response_confirmed', {
          rideRequestId,
          action,
          message: `Fare offer ${action}ed successfully`
        });
      }

      socket.emit('fare_response_sent', { message: `Fare offer ${action}ed successfully` });

    } catch (error) {
      console.error('Error handling fare response:', error);
      socket.emit('error', { message: 'Failed to process fare response' });
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
