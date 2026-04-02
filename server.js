const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
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
app.set('trust proxy', 1);
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: true, // Allow all origins in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});
app.use('/api', apiLimiter);
// Some clients send JSON with only Authorization in headers; shallow merge drops Content-Type and
// express.json skips parsing — body is empty → e.g. "Rating must be a number". Default JSON for /rate.
app.use((req, res, next) => {
  const pathOnly = typeof req.url === 'string' ? req.url.split('?')[0] : '';
  if (
    req.method === 'POST' &&
    pathOnly.includes('/api/rides/') &&
    pathOnly.endsWith('/rate')
  ) {
    const ct = req.headers['content-type'];
    if (!ct || String(ct).trim() === '') {
      req.headers['content-type'] = 'application/json';
    }
  }
  next();
});
app.use(express.json({ limit: '8mb' }));
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
const vehicleRoutes = require('./routes/vehicles');
const adminDriverRequestsRoutes = require('./routes/admin-driver-requests');
const adminAuthRoutes = require('./routes/admin-auth');
const adminDeleteRoutes = require('./routes/admin-delete');
const adminWalletTopupsRoutes = require('./routes/admin-wallet-topups');
const adminSidebarStatsRoutes = require('./routes/admin-sidebar-stats');
const supportRoutes = require('./routes/support');
const adminSupportRoutes = require('./routes/admin-support');
const rideFaresRoutes = require('./routes/ride-fares');
const adminRideFaresRoutes = require('./routes/admin-ride-fares');
const adminEmergencyRidesRoutes = require('./routes/admin-emergency-rides');
const systemSettingsRoutes = require('./routes/system-settings');
const serviceZonesRoutes = require('./routes/service-zones');
const adminPenaltiesRoutes = require('./routes/admin-penalties');
const adminAppUpdatesRoutes = require('./routes/admin-app-updates');
const appUpdatesRoutes = require('./routes/app-updates');
const adminNotificationCenterRoutes = require('./routes/admin-notification-center');
const notificationCenterRoutes = require('./routes/notification-center');
const adminLiveRidesRoutes = require('./routes/admin-live-rides');
const adminFinancialDashboardRoutes = require('./routes/admin-financial-dashboard');
const adminDashboardRoutes = require('./routes/admin-dashboard');
const { deductDriverCommissionForRide } = require('./lib/driverCommission');
const { normalizeRideTypeKey } = require('./utils/rideFarePricing');

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
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/admin', adminDriverRequestsRoutes);
app.use('/api/admin', adminAuthRoutes);
app.use('/api/admin', adminDeleteRoutes);
app.use('/api/admin', adminWalletTopupsRoutes);
app.use('/api/admin', adminSidebarStatsRoutes);
app.use('/api/admin', adminSupportRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/ride-fares', rideFaresRoutes);
app.use('/api/admin', adminRideFaresRoutes);
app.use('/api/admin', adminEmergencyRidesRoutes);
app.use('/api/admin', adminPenaltiesRoutes);
app.use('/api/admin', adminAppUpdatesRoutes);
app.use('/api/admin', adminNotificationCenterRoutes);
app.use('/api/admin', adminLiveRidesRoutes);
app.use('/api/admin', adminFinancialDashboardRoutes);
app.use('/api/admin', adminDashboardRoutes);
app.use('/api', systemSettingsRoutes);
app.use('/api', serviceZonesRoutes);
app.use('/api', appUpdatesRoutes);
app.use('/api', notificationCenterRoutes);

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
const processedEventIds = new Map(); // eventId -> processedAt
const PROCESSED_EVENT_TTL_MS = 10 * 60 * 1000;

const cleanupProcessedEventIds = () => {
  const now = Date.now();
  for (const [eventId, processedAt] of processedEventIds.entries()) {
    if (now - processedAt > PROCESSED_EVENT_TTL_MS) {
      processedEventIds.delete(eventId);
    }
  }
};

const isDuplicateEvent = (eventId) => {
  if (!eventId) return false;
  cleanupProcessedEventIds();
  return processedEventIds.has(eventId);
};

const markEventProcessed = (eventId) => {
  if (!eventId) return;
  processedEventIds.set(eventId, Date.now());
};

/** Stable Socket.IO room per user so emits survive reconnect (re-auth re-joins same room). */
const userSocketRoom = (userId) => {
  const s = userId != null ? String(userId) : '';
  return s ? `user:${s}` : null;
};
const emitToUser = (io, userId, event, payload) => {
  const uid = userId != null ? String(userId) : '';
  if (!uid) return;
  io.to(`user:${uid}`).emit(event, payload);
  const sid = activeConnections.get(uid) || driverConnections.get(uid);
  if (sid) io.to(sid).emit(event, payload);
};

const { buildDriverFareOfferEnrichment } = require('./utils/driverFareOfferEnrichment');

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`🔌 New connection: ${socket.id}`);

  // Handle user authentication
  socket.on('authenticate', (data) => {
    const { userId: rawUserId, userType } = data;
    const userId = rawUserId != null ? String(rawUserId) : '';
    if (!userId) {
      console.warn('Socket authenticate: missing userId');
      return;
    }
    activeConnections.set(userId, socket.id);
    const room = userSocketRoom(userId);
    if (room) socket.join(room);

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

      // Prevent deactivated (warning/penalty) drivers from interacting with ride requests.
      // This is enforced server-side because deactivation is based on DB fields.
      const Driver = require('./models/Driver');
      const driverDoc = await Driver.findOne({ user: driverId }).lean();
      if (driverDoc?.accountDeactivatedUntil && new Date(driverDoc.accountDeactivatedUntil).getTime() > Date.now()) {
        socket.emit('error', { message: 'Driver account is temporarily deactivated' });
        return;
      }

      // Enforce minimum wallet balance before allowing offers to reach the rider.
      // IMPORTANT: fail-closed. If we cannot verify wallet/minimum, do NOT emit to rider.
      const { getDriverMinimumWalletPkr } = require('./lib/walletSettings');
      const minimum = await getDriverMinimumWalletPkr();
      const bal = Number(driverDoc?.wallet?.balance || 0);
      if (bal < Number(minimum || 0)) {
        socket.emit('error', { message: `Insufficient wallet balance. Minimum required is ${minimum} PKR` });
        return;
      }

      if (action === 'accept') {
        // Driver accept should only send a fare offer. Final assignment happens on rider acceptance.
        if (rideRequest.status === 'pending' || rideRequest.status === 'searching') {
          if (Array.isArray(rideRequest.availableDrivers)) {
            rideRequest.availableDrivers.forEach((availableDriver) => {
              if (availableDriver.driver.toString() === driverId) {
                availableDriver.status = 'accepted';
                availableDriver.counterOffer = counterOffer || availableDriver.counterOffer;
                availableDriver.respondedAt = new Date();
              }
            });
          }
          await rideRequest.save();

          const enriched = await buildDriverFareOfferEnrichment(driverId);

          // Calculate arrival time (mock calculation - in real app, use actual distance/time)
          const arrivalTime = Math.floor(Math.random() * 10) + 5; // 5-15 minutes

          const fareAmount =
            (counterOffer != null && Number(counterOffer) > 0 && Number(counterOffer)) ||
            rideRequest.requestedPrice ||
            rideRequest.suggestedPrice ||
            0;

          // Notify rider with fare offer (user room — not raw socket id)
          emitToUser(io, rideRequest.rider, 'fare_offer', {
            rideRequestId,
            driverId,
            driverName: enriched.driverName,
            driverRating: enriched.driverRating,
            fareAmount,
            arrivalTime,
            vehicleInfo: enriched.vehicleInfo,
            vehicleName: enriched.vehicleName,
            driverPhoto: enriched.driverPhoto,
            timestamp: Date.now(),
          });
          console.log(`💰 Fare offer sent to rider ${rideRequest.rider} from driver ${driverId}`);

          socket.emit('response_success', { 
            message: 'Offer sent successfully. Waiting for rider response...',
            rideRequestId,
            waitingForRider: true
          });
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
        emitToUser(io, rideRequest.rider, 'ride_counter_offer', {
          rideRequestId,
          driverId,
          counterOffer,
          message: 'Driver has made a counter offer'
        });

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

      const Driver = require('./models/Driver');
      const driverDoc = await Driver.findOne({ user: driverId }).lean();
      if (driverDoc?.accountDeactivatedUntil && new Date(driverDoc.accountDeactivatedUntil).getTime() > Date.now()) {
        socket.emit('error', { message: 'Driver account is temporarily deactivated' });
        return;
      }

      // Enforce minimum wallet balance before allowing offers to reach the rider.
      // IMPORTANT: fail-closed. If we cannot verify wallet/minimum, do NOT emit to rider.
      const { getDriverMinimumWalletPkr } = require('./lib/walletSettings');
      const minimum = await getDriverMinimumWalletPkr();
      const bal = Number(driverDoc?.wallet?.balance || 0);
      if (bal < Number(minimum || 0)) {
        socket.emit('error', { message: `Insufficient wallet balance. Minimum required is ${minimum} PKR` });
        return;
      }

      const enriched = await buildDriverFareOfferEnrichment(driverId);
      const offerPayload = {
        driverName: enriched.driverName || driverName || 'Driver',
        driverRating: enriched.driverRating ?? driverRating ?? 0,
        fareAmount,
        arrivalTime,
        vehicleInfo: enriched.vehicleInfo || vehicleInfo || 'Vehicle',
        vehicleName: enriched.vehicleName || '',
        driverPhoto: enriched.driverPhoto || '',
      };

      // Add fare offer to ride request
      rideRequest.fareOffers.push({
        driver: driverId,
        ...offerPayload,
        offeredAt: new Date(),
        status: 'pending'
      });

      await rideRequest.save();

      // Notify rider about the fare offer
      emitToUser(io, rideRequest.rider, 'fare_offer', {
        rideRequestId,
        driverId,
        ...offerPayload,
        timestamp: Date.now(),
      });
      console.log(`💰 Fare offer sent to rider ${rideRequest.rider} from driver ${driverId}`);

      socket.emit('fare_offer_sent', { message: 'Fare offer sent successfully' });

    } catch (error) {
      console.error('Error handling fare offer:', error);
      socket.emit('error', { message: 'Failed to send fare offer' });
    }
  });

  // Driver viewed a ride request (real-time UX signal to rider)
  socket.on('ride_request_viewed', async (data) => {
    try {
      const { rideRequestId, driverId } = data || {};
      if (!rideRequestId || !driverId) return;

      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId);
      if (!rideRequest) return;

      // Only send viewed updates while rider is still searching.
      if (rideRequest.status !== 'searching' && rideRequest.status !== 'pending') return;

      // Mark viewed in the availableDrivers array (dedupe by driverId).
      let found = false;
      if (Array.isArray(rideRequest.availableDrivers)) {
        rideRequest.availableDrivers.forEach((d) => {
          if (d?.driver?.toString?.() === driverId.toString()) {
            d.status = 'viewed';
            d.viewedAt = d.viewedAt || new Date();
            found = true;
          }
        });
      }

      // If driver wasn't pre-listed (edge case), append a minimal entry.
      if (!found) {
        rideRequest.availableDrivers.push({
          driver: driverId,
          status: 'viewed',
          viewedAt: new Date(),
        });
      }

      await rideRequest.save();

      const viewedCount = (rideRequest.availableDrivers || []).filter((d) => !!d?.viewedAt).length;

      emitToUser(io, rideRequest.rider, 'ride_request_viewed', {
        rideRequestId,
        viewedCount,
        driverId,
        timestamp: Date.now(),
      });
    } catch (e) {
      console.error('Error handling ride_request_viewed:', e);
    }
  });

  // Rider/driver ride cancellation — persist + fan-out via user rooms (fare offers + available + accepted)
  socket.on('ride_cancelled', async (data, ack) => {
    try {
      const { rideRequestId, userId, userType, eventId } = data;
      if (isDuplicateEvent(eventId)) {
        if (typeof ack === 'function') ack({ ok: true, duplicate: true, eventId });
        return;
      }
      const RideRequest = require('./models/RideRequest');

      const rideRequest = await RideRequest.findById(rideRequestId);
      if (!rideRequest) {
        socket.emit('error', { message: 'Ride request not found' });
        return;
      }

      if (['cancelled', 'completed'].includes(rideRequest.status)) {
        socket.emit('ride_cancelled_ack', { rideRequestId, status: 'ok', alreadyEnded: true });
        markEventProcessed(eventId);
        if (typeof ack === 'function') ack({ ok: true, eventId, alreadyEnded: true });
        return;
      }

      // Only allow rider or accepted driver to cancel for safety
      if (userType === 'rider' && rideRequest.rider.toString() !== userId) {
        socket.emit('error', { message: 'Not authorized to cancel this ride request' });
        return;
      }
      if (userType === 'driver') {
        if (!rideRequest.acceptedBy || rideRequest.acceptedBy.toString() !== userId) {
          socket.emit('error', { message: 'Not authorized to cancel this ride request' });
          return;
        }
      }

      // Update status to cancelled
      rideRequest.status = 'cancelled';
      rideRequest.cancelledAt = new Date();
      await rideRequest.save();

      const rid = String(rideRequestId);
      const canceller = String(userId);
      const riderUid = String(rideRequest.rider);
      const payload = { rideRequestId: rid };
      const payloadDetailed = {
        rideRequestId: rid,
        message: 'Ride request has been cancelled',
        newStatus: 'cancelled',
        timestamp: new Date().toISOString(),
      };

      const driverIds = new Set();
      if (rideRequest.acceptedBy) driverIds.add(String(rideRequest.acceptedBy));
      if (Array.isArray(rideRequest.availableDrivers)) {
        rideRequest.availableDrivers.forEach((entry) => {
          if (entry?.driver) driverIds.add(String(entry.driver));
        });
      }
      if (Array.isArray(rideRequest.fareOffers)) {
        rideRequest.fareOffers.forEach((o) => {
          if (o?.driver) driverIds.add(String(o.driver));
        });
      }

      driverIds.forEach((driverId) => {
        if (String(driverId) === canceller) return;
        emitToUser(io, driverId, 'ride_request_cancelled', payloadDetailed);
        emitToUser(io, driverId, 'ride_cancelled', payload);
      });

      // Echo to rider only if someone else cancelled (e.g. driver) so their tracking closes.
      if (canceller !== riderUid) {
        emitToUser(io, riderUid, 'ride_request_cancelled', payloadDetailed);
        emitToUser(io, riderUid, 'ride_cancelled', payload);
      }

      // Acknowledge back to requester
      socket.emit('ride_cancelled_ack', { rideRequestId, status: 'ok' });
      markEventProcessed(eventId);
      if (typeof ack === 'function') ack({ ok: true, eventId });
    } catch (err) {
      console.error('Error handling ride_cancelled event:', err);
      socket.emit('error', { message: 'Failed to cancel ride request' });
      if (typeof ack === 'function') ack({ ok: false, error: 'Failed to cancel ride request' });
    }
  });

  // Handle rider response to fare offer
  socket.on('fare_response', async (data, ack) => {
    try {
      const { rideRequestId, riderId, driverId, action, eventId } = data;
      if (isDuplicateEvent(eventId)) {
        if (typeof ack === 'function') ack({ ok: true, duplicate: true, eventId });
        return;
      }
      
      // Find the ride request
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId);
      
      if (!rideRequest) {
        socket.emit('error', { message: 'Ride request not found' });
        return;
      }

      // Pick the intended offer when driverId is provided; otherwise fall back to latest pending.
      const pendingOffers = (rideRequest.fareOffers || []).filter((offer) => offer.status === 'pending');
      const targetOffer = driverId
        ? pendingOffers.find((offer) => offer.driver.toString() === String(driverId))
        : pendingOffers[pendingOffers.length - 1];
      if (!targetOffer) {
        socket.emit('error', { message: 'No pending fare offer found' });
        return;
      }

      // Update offer status (schema expects 'accepted'/'rejected', not 'accept'/'decline')
      targetOffer.status = action === 'accept' ? 'accepted' : 'rejected';
      targetOffer.respondedAt = new Date();

      if (action === 'accept') {
        // Update ride request status
        rideRequest.status = 'accepted';
        rideRequest.acceptedBy = targetOffer.driver;
        rideRequest.acceptedAt = new Date();
        
        // Cancel all other pending offers
        rideRequest.fareOffers.forEach(offer => {
          if (offer._id.toString() !== targetOffer._id.toString() && offer.status === 'pending') {
            offer.status = 'rejected';
            offer.respondedAt = new Date();
          }
        });
      }

      await rideRequest.save();

      // Notify driver about the response
      emitToUser(io, targetOffer.driver, 'fare_response', {
        rideRequestId,
        riderId,
        action,
        timestamp: Date.now()
      });
      console.log(`💰 Fare response sent to driver ${targetOffer.driver} from rider ${riderId}: ${action}`);

      // Notify rider about the response
      emitToUser(io, riderId, 'fare_response_confirmed', {
        rideRequestId,
        action,
        message: `Fare offer ${action}ed successfully`
      });

      // When rider accepts, emit driver_assigned with full driver info to rider
      if (action === 'accept') {
        try {
          const Driver = require('./models/Driver');
          const driver = await Driver.findById(targetOffer.driver).select(
            'firstName lastName phone rating vehicleType vehicleModel vehicleColor vehiclePlateNumber currentLocation'
          );
          const assignedDriverId = targetOffer.driver.toString();
          emitToUser(io, riderId, 'driver_assigned', {
            rideRequestId,
            driver: {
              _id: assignedDriverId,
              id: assignedDriverId,
              firstName: driver ? driver.firstName : 'Driver',
              lastName: driver ? driver.lastName : '',
              phone: driver ? driver.phone : '',
              rating: driver ? (driver.rating ?? 0) : 0,
              vehicleInfo: {
                make: driver ? (driver.vehicleType || 'Vehicle') : 'Vehicle',
                model: driver ? (driver.vehicleModel || '') : '',
                color: driver ? (driver.vehicleColor || '') : '',
                plateNumber: driver ? (driver.vehiclePlateNumber || '---') : '---'
              },
              currentLocation: driver ? driver.currentLocation : null
            }
          });
          console.log(`🚗 driver_assigned emitted to rider ${riderId}`);
        } catch (driverLookupErr) {
          console.error('Error fetching driver for driver_assigned:', driverLookupErr);
        }
      }

      socket.emit('fare_response_sent', { message: `Fare offer ${action}ed successfully` });
      markEventProcessed(eventId);
      if (typeof ack === 'function') ack({ ok: true, eventId });

    } catch (error) {
      console.error('Error handling fare response:', error);
      socket.emit('error', { message: 'Failed to process fare response' });
      if (typeof ack === 'function') ack({ ok: false, error: 'Failed to process fare response' });
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

  // Handle rider confirming they are at pickup location
  socket.on('rider_arrived', async (data, ack) => {
    try {
      const { rideRequestId, riderId, latitude, longitude, eventId } = data;
      if (isDuplicateEvent(eventId)) {
        if (typeof ack === 'function') ack({ ok: true, duplicate: true, eventId });
        return;
      }
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId);
      if (!rideRequest) {
        socket.emit('error', { message: 'Ride request not found' });
        return;
      }
      // Notify the driver that rider is at pickup
      const assignedDriverId = (rideRequest.acceptedBy || '').toString();
      if (!rideRequest.riderArrivedAt) {
        rideRequest.riderArrivedAt = new Date();
        await rideRequest.save();
      }
      const driverSocketId = driverConnections.get(assignedDriverId);
      if (driverSocketId) {
        const payload = { rideRequestId, riderId };
        if (typeof latitude === 'number' && typeof longitude === 'number') {
          payload.riderLocation = { latitude, longitude };
        }
        io.to(driverSocketId).emit('rider_at_pickup', payload);
        console.log(`📍 Rider ${riderId} confirmed at pickup, notifying driver ${assignedDriverId}`);
      }
      markEventProcessed(eventId);
      if (typeof ack === 'function') ack({ ok: true, eventId });
    } catch (err) {
      console.error('Error handling rider_arrived:', err);
      socket.emit('error', { message: 'Failed to notify driver' });
      if (typeof ack === 'function') ack({ ok: false, error: 'Failed to notify driver' });
    }
  });

  // Real-time chat between rider and assigned driver (persisted for admin review)
  socket.on('ride_chat_message', async (data) => {
    try {
      const { rideRequestId, senderId, senderType, text, timestamp } = data || {};
      if (!rideRequestId || !senderId || !senderType || typeof text !== 'string') {
        socket.emit('error', { message: 'Invalid chat message payload' });
        return;
      }

      const trimmed = text.trim();
      if (!trimmed) return;

      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy status');
      if (!rideRequest) {
        socket.emit('error', { message: 'Ride request not found' });
        return;
      }

      const riderId = (rideRequest.rider || '').toString();
      const driverId = (rideRequest.acceptedBy || '').toString();
      if (!riderId || !driverId) {
        socket.emit('error', { message: 'Ride is not assigned yet' });
        return;
      }

      const sender = senderId.toString();
      if (sender !== riderId && sender !== driverId) {
        socket.emit('error', { message: 'Not authorized to chat on this ride' });
        return;
      }

      const recipientSocketId =
        senderType === 'rider'
          ? driverConnections.get(driverId)
          : activeConnections.get(riderId);

      const payload = {
        rideRequestId,
        senderId: sender,
        senderType,
        text: trimmed,
        timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
      };

      // Best-effort persistence for admin "Live Rides" communication log.
      try {
        const RideChatMessage = require('./models/RideChatMessage');
        await RideChatMessage.create({
          rideRequest: rideRequestId,
          sender,
          senderType,
          text: trimmed,
          timestamp: payload.timestamp,
        });
      } catch (persistErr) {
        console.error('ride_chat_message persist error (non-fatal):', persistErr?.message || persistErr);
      }

      // Echo to sender + forward to recipient (if connected)
      socket.emit('ride_chat_message', payload);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('ride_chat_message', payload);
      }
    } catch (err) {
      console.error('Error handling ride_chat_message:', err);
      socket.emit('error', { message: 'Failed to send chat message' });
    }
  });

  // In-app call signaling between rider and assigned driver
  socket.on('ride_call_request', async (data, ack) => {
    try {
      const { rideRequestId, callerId, callerType, timestamp, eventId } = data || {};
      if (isDuplicateEvent(eventId)) {
        if (typeof ack === 'function') ack({ ok: true, duplicate: true, eventId });
        return;
      }
      if (!rideRequestId || !callerId || !callerType) return;
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy');
      if (!rideRequest) return;

      const riderId = (rideRequest.rider || '').toString();
      const driverId = (rideRequest.acceptedBy || '').toString();
      if (!riderId || !driverId) return;

      const recipientSocketId =
        callerType === 'rider'
          ? driverConnections.get(driverId)
          : activeConnections.get(riderId);

      const payload = {
        rideRequestId,
        callerId: callerId.toString(),
        callerType,
        timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
      };

      if (recipientSocketId) {
        io.to(recipientSocketId).emit('ride_call_request', payload);
      }
      socket.emit('ride_call_request_ack', { rideRequestId, status: 'sent' });
      markEventProcessed(eventId);
      if (typeof ack === 'function') ack({ ok: true, eventId });
    } catch (err) {
      console.error('Error handling ride_call_request:', err);
      socket.emit('error', { message: 'Failed to start ride call' });
      if (typeof ack === 'function') ack({ ok: false, error: 'Failed to start ride call' });
    }
  });

  socket.on('ride_call_response', async (data, ack) => {
    try {
      const { rideRequestId, responderId, responderType, action, timestamp, eventId } = data || {};
      if (isDuplicateEvent(eventId)) {
        if (typeof ack === 'function') ack({ ok: true, duplicate: true, eventId });
        return;
      }
      if (!rideRequestId || !responderId || !responderType || !action) return;
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy');
      if (!rideRequest) return;

      const riderId = (rideRequest.rider || '').toString();
      const driverId = (rideRequest.acceptedBy || '').toString();
      const recipientSocketId =
        responderType === 'rider'
          ? driverConnections.get(driverId)
          : activeConnections.get(riderId);

      const payload = {
        rideRequestId,
        responderId: responderId.toString(),
        responderType,
        action, // accept | decline
        timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
      };

      if (recipientSocketId) {
        io.to(recipientSocketId).emit('ride_call_response', payload);
      }
      socket.emit('ride_call_response_ack', { rideRequestId, status: 'sent' });
      markEventProcessed(eventId);
      if (typeof ack === 'function') ack({ ok: true, eventId });
    } catch (err) {
      console.error('Error handling ride_call_response:', err);
      socket.emit('error', { message: 'Failed to send ride call response' });
      if (typeof ack === 'function') ack({ ok: false, error: 'Failed to send ride call response' });
    }
  });

  socket.on('ride_call_end', async (data, ack) => {
    try {
      const { rideRequestId, userId, userType, timestamp, eventId } = data || {};
      if (isDuplicateEvent(eventId)) {
        if (typeof ack === 'function') ack({ ok: true, duplicate: true, eventId });
        return;
      }
      if (!rideRequestId || !userId || !userType) return;
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy');
      if (!rideRequest) return;

      const riderId = (rideRequest.rider || '').toString();
      const driverId = (rideRequest.acceptedBy || '').toString();
      const recipientSocketId =
        userType === 'rider'
          ? driverConnections.get(driverId)
          : activeConnections.get(riderId);

      const payload = {
        rideRequestId,
        userId: userId.toString(),
        userType,
        timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
      };

      if (recipientSocketId) {
        io.to(recipientSocketId).emit('ride_call_ended', payload);
      }
      socket.emit('ride_call_ended', payload);
      markEventProcessed(eventId);
      if (typeof ack === 'function') ack({ ok: true, eventId });
    } catch (err) {
      console.error('Error handling ride_call_end:', err);
      socket.emit('error', { message: 'Failed to end ride call' });
      if (typeof ack === 'function') ack({ ok: false, error: 'Failed to end ride call' });
    }
  });

  // WebRTC offer relay
  socket.on('ride_call_offer', async (data) => {
    try {
      const { rideRequestId, fromType, offer } = data || {};
      if (!rideRequestId || !fromType || !offer) return;
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy');
      if (!rideRequest) return;
      const riderId = (rideRequest.rider || '').toString();
      const driverId = (rideRequest.acceptedBy || '').toString();
      const recipientSocketId =
        fromType === 'rider'
          ? driverConnections.get(driverId)
          : activeConnections.get(riderId);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('ride_call_offer', data);
      }
    } catch (err) {
      console.error('Error handling ride_call_offer:', err);
    }
  });

  // WebRTC answer relay
  socket.on('ride_call_answer', async (data) => {
    try {
      const { rideRequestId, fromType, answer } = data || {};
      if (!rideRequestId || !fromType || !answer) return;
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy');
      if (!rideRequest) return;
      const riderId = (rideRequest.rider || '').toString();
      const driverId = (rideRequest.acceptedBy || '').toString();
      const recipientSocketId =
        fromType === 'rider'
          ? driverConnections.get(driverId)
          : activeConnections.get(riderId);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('ride_call_answer', data);
      }
    } catch (err) {
      console.error('Error handling ride_call_answer:', err);
    }
  });

  // WebRTC ICE relay
  socket.on('ride_call_ice_candidate', async (data) => {
    try {
      const { rideRequestId, fromType, candidate } = data || {};
      if (!rideRequestId || !fromType || !candidate) return;
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy');
      if (!rideRequest) return;
      const riderId = (rideRequest.rider || '').toString();
      const driverId = (rideRequest.acceptedBy || '').toString();
      const recipientSocketId =
        fromType === 'rider'
          ? driverConnections.get(driverId)
          : activeConnections.get(riderId);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('ride_call_ice_candidate', data);
      }
    } catch (err) {
      console.error('Error handling ride_call_ice_candidate:', err);
    }
  });

  // Handle driver starting the ride
  socket.on('start_ride', async (data, ack) => {
    try {
      const { rideRequestId, driverId, eventId } = data;
      if (isDuplicateEvent(eventId)) {
        if (typeof ack === 'function') ack({ ok: true, duplicate: true, eventId });
        return;
      }
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId);
      if (!rideRequest) {
        socket.emit('error', { message: 'Ride request not found' });
        return;
      }
      rideRequest.status = 'in_progress';
      rideRequest.startedAt = new Date();
      await rideRequest.save();
      // Notify rider that ride has started
      emitToUser(io, rideRequest.rider, 'ride_started', { rideRequestId, driverId });
      console.log(`🚗 Ride ${rideRequestId} started by driver ${driverId}`);
      socket.emit('ride_started_ack', { rideRequestId });
      markEventProcessed(eventId);
      if (typeof ack === 'function') ack({ ok: true, eventId });
    } catch (err) {
      console.error('Error handling start_ride:', err);
      socket.emit('error', { message: 'Failed to start ride' });
      if (typeof ack === 'function') ack({ ok: false, error: 'Failed to start ride' });
    }
  });

  // Handle driver ending the ride
  socket.on('end_ride', async (data, ack) => {
    try {
      const { rideRequestId, driverId, eventId } = data;
      if (isDuplicateEvent(eventId)) {
        if (typeof ack === 'function') ack({ ok: true, duplicate: true, eventId });
        return;
      }
      const RideRequest = require('./models/RideRequest');
      const Ride = require('./models/Ride');
      const rideRequest = await RideRequest.findById(rideRequestId);
      if (!rideRequest) {
        socket.emit('error', { message: 'Ride request not found' });
        return;
      }
      rideRequest.status = 'completed';
      rideRequest.completedAt = new Date();
      await rideRequest.save();

      const effectiveDriverId = rideRequest.acceptedBy
        ? String(rideRequest.acceptedBy)
        : String(driverId || '');

      const riderUid =
        rideRequest.rider && rideRequest.rider._id != null
          ? rideRequest.rider._id
          : rideRequest.rider;
      const completionPayload = { rideRequestId, driverId: effectiveDriverId || driverId };

      // Emit FIRST so clients always get notified even if Ride bridge fails later.
      emitToUser(io, riderUid, 'ride_completed', completionPayload);
      if (effectiveDriverId) emitToUser(io, effectiveDriverId, 'ride_completed', completionPayload);
      socket.emit('ride_completed', { rideRequestId });

      // Ensure a Ride document exists for the rating system.
      // The app currently rates using POST `/api/rides/:rideId/rate`,
      // while websocket lifecycle uses RideRequest documents.
      // We bridge them by creating a Ride with `_id === rideRequestId`.
      try {
        const existingRide = await Ride.findById(rideRequest._id).select('_id');
        if (!existingRide) {
          const effectiveDestination = {
            address:
              rideRequest.destination?.address ||
              rideRequest.destinationLocation?.address ||
              '',
            latitude: rideRequest.destination?.latitude ?? rideRequest.destinationLocation?.latitude ?? 0,
            longitude: rideRequest.destination?.longitude ?? rideRequest.destinationLocation?.longitude ?? 0,
          };

          const ride = new Ride({
            _id: rideRequest._id,
            rider: rideRequest.rider,
            driver: effectiveDriverId || driverId || null,
            pickup: {
              address: rideRequest.pickupLocation?.address || '',
              location: {
                type: 'Point',
                coordinates: [
                  rideRequest.pickupLocation?.longitude || 0,
                  rideRequest.pickupLocation?.latitude || 0,
                ],
              },
            },
            destination: {
              address: effectiveDestination.address || '',
              location: {
                type: 'Point',
                coordinates: [effectiveDestination.longitude || 0, effectiveDestination.latitude || 0],
              },
            },
            status: 'completed',
            rideType: normalizeRideTypeKey(rideRequest.vehicleType || 'ride_mini'),
            price: {
              amount: rideRequest.requestedPrice || rideRequest.suggestedPrice || 0,
              currency: 'PKR',
              negotiated: true,
            },
            distance: rideRequest.distance || 0,
            duration: rideRequest.estimatedDuration || 0,
            paymentMethod: rideRequest.paymentMethod || 'cash',
            rating: {
              riderRating: null,
              driverRating: null,
              riderComment: null,
              driverComment: null,
            },
            endTime: new Date(),
          });

          await ride.save();
        }
      } catch (bridgeErr) {
        console.error('end_ride Ride bridge error (non-fatal):', bridgeErr?.message || bridgeErr);
      }

      // Deduct commission (idempotent via DriverWalletTransaction.rideId)
      try {
        const driverUserId = effectiveDriverId || driverId;
        if (driverUserId) {
          const fare = rideRequest.requestedPrice || rideRequest.suggestedPrice || 0;
          const result = await deductDriverCommissionForRide({
            rideId: rideRequest._id,
            driverUserId,
            vehicleType: rideRequest.vehicleType || 'ride_mini',
            fareAmount: fare,
          });
          if (result?.deducted) {
            await Ride.findByIdAndUpdate(rideRequest._id, {
              $set: {
                driverCommissionPct: result.pct || 0,
                driverCommissionAmount: result.amount || 0,
                commissionDeductedAt: new Date(),
              },
            });
          }
        }
      } catch (e) {
        // ignore
      }

      console.log(`✅ Ride ${rideRequestId} completed by driver ${effectiveDriverId || driverId}`);
      markEventProcessed(eventId);
      if (typeof ack === 'function') ack({ ok: true, eventId });
    } catch (err) {
      console.error('Error handling end_ride:', err);
      socket.emit('error', { message: 'Failed to end ride' });
      if (typeof ack === 'function') ack({ ok: false, error: 'Failed to end ride' });
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

async function startServer() {
  const redisUrl = process.env.REDIS_URL || process.env.REDISCLOUD_URL;
  if (redisUrl) {
    try {
      const { createClient } = require('redis');
      const { createAdapter } = require('@socket.io/redis-adapter');
      const pubClient = createClient({ url: redisUrl });
      const subClient = pubClient.duplicate();
      pubClient.on('error', (e) => console.error('Redis pub client error:', e.message));
      subClient.on('error', (e) => console.error('Redis sub client error:', e.message));
      await Promise.all([pubClient.connect(), subClient.connect()]);
      io.adapter(createAdapter(pubClient, subClient));
      console.log('✅ Socket.IO Redis adapter enabled (multi-instance safe)');
    } catch (e) {
      console.error(
        '⚠️ Socket.IO Redis adapter failed; use a single instance or fix REDIS_URL:',
        e.message || e
      );
    }
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Server accessible at:`);
    console.log(`  - Local: http://localhost:${PORT}`);
    console.log(`  - Network: http://${networkIP}:${PORT}`);
    console.log(`  - All interfaces: 0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
