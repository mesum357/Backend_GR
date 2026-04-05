const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const passport = require('passport');
const session = require('express-session');
const http = require('http');
const crypto = require('crypto');
const socketIo = require('socket.io');
require('dotenv').config();

// Import passport configuration
require('./config/passport');

// Import Firebase configuration
const firebase = require('./config/firebase');
const { ensureRideRoutePolylineSaved } = require('./services/ensureRideRoutePolyline');

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
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_PER_WINDOW = Number(process.env.API_RATE_LIMIT_MAX_PER_MINUTE || 600);

function apiRateLimitKey(req) {
  const auth = req.headers?.authorization;
  if (auth && typeof auth === 'string' && auth.startsWith('Bearer ') && auth.length > 24) {
    const hash = crypto.createHash('sha256').update(auth).digest('hex').slice(0, 32);
    return `user:${hash}`;
  }
  return `ip:${req.ip || 'unknown'}`;
}

const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: Math.max(120, Math.min(RATE_LIMIT_MAX_PER_WINDOW, 5000)),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => apiRateLimitKey(req),
  skip: (req) => {
    const path = (req.originalUrl || req.url || '').split('?')[0];
    return path === '/api/health' || path.endsWith('/api/health');
  },
  message: {
    error: 'RATE_LIMIT',
    message:
      'Too many actions in a short time. Please wait a few seconds and try again.',
  },
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

// Database (connect in startServer — must succeed before listen; otherwise admin login works but DB routes 500)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/tourist_app';

async function connectMongo() {
  await mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log('Connected to MongoDB');
}

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

// Health check endpoint (mongo readyState: 0=disconnected 1=connected 2=connecting 3=disconnecting)
app.get('/api/health', (req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  res.status(mongoOk ? 200 : 503).json({
    status: mongoOk ? 'OK' : 'degraded',
    message: mongoOk ? 'Server is running' : 'MongoDB not connected',
    mongo: { ready: mongoOk, readyState: mongoose.connection.readyState },
    firebase: firebase.admin ? 'Initialized' : 'Not configured',
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
/** rideRequestId -> { riderId, driverId } — cached for ride_presence without repeated DB reads */
const ridePresenceParticipants = new Map();
/** userId -> Set<rideRequestId> — who asked for presence updates (re-notify on reconnect) */
const ridePresenceSubscriberRides = new Map();
const processedEventIds = new Map(); // eventId -> processedAt
const PROCESSED_EVENT_TTL_MS = 10 * 60 * 1000;

/** ride_live_location throttle: senderId -> lastRelayTimestamp */
const liveLocationLastRelay = new Map();
const LIVE_LOCATION_MIN_INTERVAL_MS = 2000;

const cleanupProcessedEventIds = () => {
  const now = Date.now();
  for (const [eventId, processedAt] of processedEventIds.entries()) {
    if (now - processedAt > PROCESSED_EVENT_TTL_MS) {
      processedEventIds.delete(eventId);
    }
  }
  for (const [key, ts] of liveLocationLastRelay.entries()) {
    if (now - ts > 60000) liveLocationLastRelay.delete(key);
  }
};
setInterval(cleanupProcessedEventIds, 60 * 1000);

const isDuplicateEvent = (eventId) => {
  if (!eventId) return false;
  cleanupProcessedEventIds();
  return processedEventIds.has(eventId);
};

const markEventProcessed = (eventId) => {
  if (!eventId) return;
  processedEventIds.set(eventId, Date.now());
};

// Periodic cleanup every 5 minutes so Maps grow bounded even during idle periods
setInterval(() => {
  cleanupProcessedEventIds();
  // Also purge stale ridePresenceParticipants (older than 4 hours — ride should be done by then)
  const PRESENCE_MAX_AGE_MS = 4 * 60 * 60 * 1000;
  if (ridePresenceParticipants.size > 500) {
    ridePresenceParticipants.clear();
  }
}, 5 * 60 * 1000).unref();

/** Stable Socket.IO room per user so emits survive reconnect (re-auth re-joins same room). */
const userSocketRoom = (userId) => {
  const s = userId != null ? String(userId) : '';
  return s ? `user:${s}` : null;
};
const emitToUser = (io, userId, event, payload) => {
  const uid = userId != null ? String(userId) : '';
  if (!uid) return;
  io.to(`user:${uid}`).emit(event, payload);
};

const { buildDriverFareOfferEnrichment } = require('./utils/driverFareOfferEnrichment');

// Fare-offer response timeouts (driver waits 15 seconds for rider).
// Keyed by `${rideRequestId}:${driverId}` -> timeoutId
const fareResponseTimeouts = new Map();
const FARE_RESPONSE_TIMEOUT_MS = 15000;

function clearFareResponseTimeout(rideRequestId, driverId) {
  const key = `${String(rideRequestId)}:${String(driverId)}`;
  const t = fareResponseTimeouts.get(key);
  if (t) clearTimeout(t);
  fareResponseTimeouts.delete(key);
}

async function notifyRidePresence(ioInstance, rideRequestId) {
  const rid = rideRequestId != null ? String(rideRequestId) : '';
  if (!rid) return;
  let pair = ridePresenceParticipants.get(rid);
  if (!pair) {
    const RideRequest = require('./models/RideRequest');
    const rr = await RideRequest.findById(rid).select('rider acceptedBy').lean();
    if (!rr?.rider || !rr.acceptedBy) return;
    pair = { riderId: String(rr.rider), driverId: String(rr.acceptedBy) };
    ridePresenceParticipants.set(rid, pair);
  }
  const { riderId, driverId } = pair;
  const riderOnline = !!activeConnections.get(riderId);
  const driverOnline = !!driverConnections.get(driverId);
  const payload = {
    rideRequestId: rid,
    riderOnline,
    driverOnline,
    timestamp: Date.now(),
  };
  emitToUser(ioInstance, riderId, 'ride_presence', payload);
  emitToUser(ioInstance, driverId, 'ride_presence', payload);
}

async function scheduleFareResponseTimeout(io, rideRequestId, driverId) {
  const key = `${String(rideRequestId)}:${String(driverId)}`;
  const existing = fareResponseTimeouts.get(key);
  if (existing) clearTimeout(existing);

  const timeoutId = setTimeout(async () => {
    try {
      const RideRequest = require('./models/RideRequest');
      const rr = await RideRequest.findById(rideRequestId).select('status fareOffers acceptedBy').lean();
      if (!rr) return;
      // If already accepted/assigned, don't timeout.
      if (String(rr.status || '').toLowerCase() === 'accepted' || rr.acceptedBy) return;

      const pending = (rr.fareOffers || []).find(
        (o) => String(o?.driver) === String(driverId) && String(o?.status) === 'pending'
      );
      if (!pending) return;

      emitToUser(io, driverId, 'fare_response_timeout', {
        rideRequestId: String(rideRequestId),
        driverId: String(driverId),
        timestamp: Date.now(),
      });
    } catch (e) {
      console.error('scheduleFareResponseTimeout error (non-fatal):', e?.message || e);
    } finally {
      fareResponseTimeouts.delete(key);
    }
  }, FARE_RESPONSE_TIMEOUT_MS);

  fareResponseTimeouts.set(key, timeoutId);
}

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
    socket.data.userId = userId;
    socket.data.userType = userType === 'driver' ? 'driver' : 'rider';
    activeConnections.set(userId, socket.id);
    const room = userSocketRoom(userId);
    if (room) socket.join(room);

    if (userType === 'driver') {
      driverConnections.set(userId, socket.id);
      console.log(`🚗 Driver ${userId} connected`);
    } else {
      console.log(`👤 Rider ${userId} connected`);
    }

    const subs = ridePresenceSubscriberRides.get(userId);
    if (subs && subs.size) {
      for (const rrKey of subs) {
        notifyRidePresence(io, rrKey).catch(() => {});
      }
    }
  });

  // Rider/driver subscribe to real-time presence for message ticks (socket connected = online).
  socket.on('ride_presence_subscribe', async (data) => {
    try {
      const uid = socket.data?.userId;
      if (!uid) return;
      const rideRequestId = data?.rideRequestId;
      if (!rideRequestId) return;

      const RideRequest = require('./models/RideRequest');
      const rr = await RideRequest.findById(rideRequestId).select('rider acceptedBy').lean();
      if (!rr?.rider || !rr.acceptedBy) return;

      const riderId = String(rr.rider);
      const driverId = String(rr.acceptedBy);
      const sid = String(uid);
      if (sid !== riderId && sid !== driverId) return;

      const rrKey = String(rideRequestId);
      ridePresenceParticipants.set(rrKey, { riderId, driverId });
      if (!ridePresenceSubscriberRides.has(sid)) ridePresenceSubscriberRides.set(sid, new Set());
      ridePresenceSubscriberRides.get(sid).add(rrKey);

      await notifyRidePresence(io, rrKey);
    } catch (e) {
      console.error('ride_presence_subscribe error:', e?.message || e);
    }
  });

  socket.on('ride_presence_unsubscribe', (data) => {
    try {
      const uid = socket.data?.userId;
      if (!uid) return;
      const rideRequestId = data?.rideRequestId;
      if (!rideRequestId) return;
      const set = ridePresenceSubscriberRides.get(String(uid));
      if (!set) return;
      set.delete(String(rideRequestId));
      if (set.size === 0) ridePresenceSubscriberRides.delete(String(uid));
    } catch (e) {
      console.error('ride_presence_unsubscribe error:', e?.message || e);
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

          // Estimate arrival from driver distance to pickup using Haversine + average city speed
          let arrivalTime = 8;
          try {
            const driverEntry = (rideRequest.availableDrivers || []).find(
              (d) => d.driver && d.driver.toString() === String(driverId)
            );
            const distKm = driverEntry?.distance || 1;
            const AVG_CITY_SPEED_KPH = 25;
            arrivalTime = Math.max(2, Math.round((distKm / AVG_CITY_SPEED_KPH) * 60));
          } catch (_) { /* fallback to 8 min */ }

          const fareAmount =
            (counterOffer != null && Number(counterOffer) > 0 && Number(counterOffer)) ||
            rideRequest.requestedPrice ||
            rideRequest.suggestedPrice ||
            0;

          const distForOffer = (() => {
            try {
              const driverEntry = (rideRequest.availableDrivers || []).find(
                (d) => d.driver && d.driver.toString() === String(driverId)
              );
              const dk = driverEntry?.distance;
              return typeof dk === 'number' && Number.isFinite(dk) ? dk : null;
            } catch {
              return null;
            }
          })();

          // Notify rider with fare offer (user room — not raw socket id)
          emitToUser(io, rideRequest.rider, 'fare_offer', {
            rideRequestId,
            driverId,
            driverName: enriched.driverName,
            driverRating: enriched.driverRating,
            fareAmount,
            arrivalTime,
            driverDistanceKm: distForOffer,
            vehicleInfo: enriched.vehicleInfo,
            vehicleName: enriched.vehicleName,
            driverPhoto: enriched.driverPhoto,
            timestamp: Date.now(),
          });
          console.log(`💰 Fare offer sent to rider ${rideRequest.rider} from driver ${driverId}`);

          // Driver should wait 15 seconds for rider response.
          await scheduleFareResponseTimeout(io, rideRequestId, driverId);

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
      const driverEntryForDist = (rideRequest.availableDrivers || []).find(
        (d) => d.driver && d.driver.toString() === String(driverId)
      );
      const dk = driverEntryForDist?.distance;
      const driverDistanceKm = typeof dk === 'number' && Number.isFinite(dk) ? dk : null;

      const offerPayload = {
        driverName: enriched.driverName || driverName || 'Driver',
        driverRating: enriched.driverRating ?? driverRating ?? 0,
        fareAmount,
        arrivalTime,
        driverDistanceKm,
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

      // Driver should wait 15 seconds for rider response.
      await scheduleFareResponseTimeout(io, rideRequestId, driverId);

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
      
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId);
      
      if (!rideRequest) {
        socket.emit('error', { message: 'Ride request not found' });
        return;
      }

      // Reject if the ride request has expired
      if (rideRequest.expiresAt && new Date(rideRequest.expiresAt).getTime() < Date.now()) {
        socket.emit('error', { message: 'Ride request has expired' });
        return;
      }

      // Reject if already accepted/completed/cancelled
      if (['accepted', 'completed', 'cancelled', 'in_progress'].includes(rideRequest.status)) {
        socket.emit('error', { message: 'Ride request is no longer available for fare responses' });
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
      if (action === 'accept') {
        await ensureRideRoutePolylineSaved(rideRequest);
      }

      // Notify driver about the response
      emitToUser(io, targetOffer.driver, 'fare_response', {
        rideRequestId,
        riderId,
        action,
        timestamp: Date.now()
      });
      console.log(`💰 Fare response sent to driver ${targetOffer.driver} from rider ${riderId}: ${action}`);

      // Clear timeout for the offer's driver, and also clear other drivers on accept (we reject pending offers).
      clearFareResponseTimeout(rideRequestId, targetOffer.driver);
      if (action === 'accept') {
        const otherDrivers = new Set((rideRequest.fareOffers || []).map((o) => String(o.driver)));
        otherDrivers.forEach((d) => clearFareResponseTimeout(rideRequestId, d));
      }

      // Notify rider about the response
      emitToUser(io, riderId, 'fare_response_confirmed', {
        rideRequestId,
        action,
        message: `Fare offer ${action}ed successfully`
      });

      // When rider accepts, emit driver_assigned with full driver info to rider
      // Note: fareOffers[].driver is a User id — resolve Driver via { user } and names via User.
      if (action === 'accept') {
        try {
          const Driver = require('./models/Driver');
          const User = require('./models/User');
          const assignedDriverId = targetOffer.driver.toString();
          const [driverUser, driverDoc] = await Promise.all([
            User.findById(targetOffer.driver).select('firstName lastName phone rating profileImage').lean(),
            Driver.findOne({ user: targetOffer.driver })
              .select('vehicleInfo rating currentLocation')
              .lean(),
          ]);
          const v = driverDoc?.vehicleInfo;
          const driverRating =
            typeof driverDoc?.rating === 'number' && driverDoc.rating > 0
              ? driverDoc.rating
              : typeof driverUser?.rating === 'number'
                ? driverUser.rating
                : 0;
          emitToUser(io, riderId, 'driver_assigned', {
            rideRequestId,
            driver: {
              _id: assignedDriverId,
              id: assignedDriverId,
              firstName: driverUser?.firstName || 'Driver',
              lastName: driverUser?.lastName || '',
              phone: driverUser?.phone || '',
              rating: driverRating,
              profileImage: driverUser?.profileImage || null,
              vehicleInfo: {
                make: v?.make || v?.vehicleType || 'Vehicle',
                model: v?.model || '',
                color: v?.color || '',
                plateNumber: v?.plateNumber || '---',
                vehicleName: v?.vehicleName || null,
              },
              currentLocation: driverDoc?.currentLocation || null,
            },
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
      await ensureRideRoutePolylineSaved(rideRequest);

      // Notify driver (use room-based delivery for reconnect safety)
      emitToUser(io, driverId, 'counter_offer_accepted', {
        rideRequestId,
        message: 'Your counter offer has been accepted'
      });

      // Notify rider
      emitToUser(io, rideRequest.rider, 'counter_offer_accepted', {
        rideRequestId,
        message: 'Counter offer accepted successfully'
      });

      // Notify other drivers
      rideRequest.availableDrivers.forEach(availableDriver => {
        if (availableDriver.driver.toString() !== driverId) {
          emitToUser(io, availableDriver.driver.toString(), 'ride_request_cancelled', {
            rideRequestId,
            message: 'This ride request has been accepted by another driver'
          });
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
      const payload = { rideRequestId, riderId };
      if (typeof latitude === 'number' && typeof longitude === 'number') {
        payload.riderLocation = { latitude, longitude };
      }
      emitToUser(io, assignedDriverId, 'rider_at_pickup', payload);
      console.log(`📍 Rider ${riderId} confirmed at pickup, notifying driver ${assignedDriverId}`);
      markEventProcessed(eventId);
      if (typeof ack === 'function') ack({ ok: true, eventId });
    } catch (err) {
      console.error('Error handling rider_arrived:', err);
      socket.emit('error', { message: 'Failed to notify driver' });
      if (typeof ack === 'function') ack({ ok: false, error: 'Failed to notify driver' });
    }
  });

  // Throttled live GPS during active ride (rider <-> driver maps)
  // Server-side throttle: one relay per sender per 2 seconds
  const liveLocLastEmit = new Map(); // `${rideRequestId}:${senderId}` -> timestamp
  const LIVE_LOC_THROTTLE_MS = 2000;

  socket.on('ride_live_location', async (data) => {
    try {
      const { rideRequestId, senderId, senderType, latitude, longitude, heading } = data || {};
      if (!rideRequestId || !senderId || !senderType) return;
      if (typeof latitude !== 'number' || typeof longitude !== 'number') return;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

      const throttleKey = `${rideRequestId}:${senderId}`;
      const now = Date.now();
      const lastEmit = liveLocLastEmit.get(throttleKey) || 0;
      if (now - lastEmit < LIVE_LOC_THROTTLE_MS) return;
      liveLocLastEmit.set(throttleKey, now);

      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy status').lean();
      if (!rideRequest) return;

      const liveRiderId = (rideRequest.rider || '').toString();
      const liveDriverId = (rideRequest.acceptedBy || '').toString();
      const sid = senderId.toString();
      if (sid !== liveRiderId && sid !== liveDriverId) return;

      const payload = {
        rideRequestId: String(rideRequestId),
        senderType,
        latitude,
        longitude,
        timestamp: now,
        ...(typeof heading === 'number' && Number.isFinite(heading) ? { heading } : {}),
      };

      if (senderType === 'rider') {
        emitToUser(io, liveDriverId, 'ride_live_location', payload);
      } else if (senderType === 'driver') {
        emitToUser(io, liveRiderId, 'ride_live_location', payload);
      }
    } catch (err) {
      console.error('Error handling ride_live_location:', err);
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
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy status').lean();
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

      const recipientId = senderType === 'rider' ? driverId : riderId;

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

      socket.emit('ride_chat_message', payload);
      emitToUser(io, recipientId, 'ride_chat_message', payload);
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
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy').lean();
      if (!rideRequest) return;

      const riderId = (rideRequest.rider || '').toString();
      const driverId = (rideRequest.acceptedBy || '').toString();
      if (!riderId || !driverId) return;

      const recipientId = callerType === 'rider' ? driverId : riderId;

      const payload = {
        rideRequestId,
        callerId: callerId.toString(),
        callerType,
        timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
      };

      emitToUser(io, recipientId, 'ride_call_request', payload);
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
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy').lean();
      if (!rideRequest) return;

      const riderId = (rideRequest.rider || '').toString();
      const driverId = (rideRequest.acceptedBy || '').toString();
      const recipientId = responderType === 'rider' ? driverId : riderId;

      const payload = {
        rideRequestId,
        responderId: responderId.toString(),
        responderType,
        action,
        timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
      };

      emitToUser(io, recipientId, 'ride_call_response', payload);
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
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy').lean();
      if (!rideRequest) return;

      const riderId = (rideRequest.rider || '').toString();
      const driverId = (rideRequest.acceptedBy || '').toString();
      const recipientId = userType === 'rider' ? driverId : riderId;

      const payload = {
        rideRequestId,
        userId: userId.toString(),
        userType,
        timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
      };

      emitToUser(io, recipientId, 'ride_call_ended', payload);
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
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy').lean();
      if (!rideRequest) return;
      const riderId = (rideRequest.rider || '').toString();
      const driverId = (rideRequest.acceptedBy || '').toString();
      const recipientId = fromType === 'rider' ? driverId : riderId;
      emitToUser(io, recipientId, 'ride_call_offer', data);
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
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy').lean();
      if (!rideRequest) return;
      const riderId = (rideRequest.rider || '').toString();
      const driverId = (rideRequest.acceptedBy || '').toString();
      const recipientId = fromType === 'rider' ? driverId : riderId;
      emitToUser(io, recipientId, 'ride_call_answer', data);
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
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy').lean();
      if (!rideRequest) return;
      const riderId = (rideRequest.rider || '').toString();
      const driverId = (rideRequest.acceptedBy || '').toString();
      const recipientId = fromType === 'rider' ? driverId : riderId;
      emitToUser(io, recipientId, 'ride_call_ice_candidate', data);
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

    let disconnectedUserId = null;
    for (const [userId, socketId] of activeConnections.entries()) {
      if (socketId === socket.id) {
        disconnectedUserId = userId;
        activeConnections.delete(userId);
        driverConnections.delete(userId);
        console.log(`👤 User ${userId} disconnected`);
        break;
      }
    }

    if (disconnectedUserId) {
      const rides = ridePresenceSubscriberRides.get(disconnectedUserId);
      if (rides && rides.size) {
        for (const rrKey of [...rides]) {
          notifyRidePresence(io, rrKey).catch(() => {});
        }
      }
    }
  });
});

// Make io and connection maps available to routes
app.set('io', io);
app.set('activeConnections', activeConnections);
app.set('driverConnections', driverConnections);
// Expose fare-response timeout scheduling for REST endpoints (ride-requests /respond).
app.set('scheduleFareResponseTimeout', (rideRequestId, driverId) =>
  scheduleFareResponseTimeout(io, rideRequestId, driverId)
);
app.set('clearFareResponseTimeout', (rideRequestId, driverId) =>
  clearFareResponseTimeout(rideRequestId, driverId)
);

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
  try {
    await connectMongo();
  } catch (err) {
    console.error('MongoDB connection error:', err?.message || err);
    process.exit(1);
  }

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
