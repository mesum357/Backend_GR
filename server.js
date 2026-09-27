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

const { ensureRideRoutePolylineSaved } = require('./services/ensureRideRoutePolyline');

const app = express();

// Middleware
app.set('trust proxy', 1);
app.use(helmet());
app.use(compression());
// Browser CORS allowlist (comma-separated). Mobile clients often send no Origin — those are allowed.
// Example: CORS_ORIGINS=https://admin.mesumabbas.online,https://mesumabbas.online
const CORS_ORIGIN_LIST = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isCorsOriginAllowed(origin) {
  if (!origin) return true; // native apps / same-origin proxies
  if (process.env.NODE_ENV !== 'production') return true;
  if (CORS_ORIGIN_LIST.length === 0) return true; // unset = allow (set CORS_ORIGINS to lock down)
  if (CORS_ORIGIN_LIST.includes('*')) return true;
  return CORS_ORIGIN_LIST.includes(origin);
}

app.use(cors({
  origin: (origin, callback) => {
    if (isCorsOriginAllowed(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
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
// Driver signup can include multiple base64 images (profile + vehicle + license + CNIC front/back).
// Keep a practical ceiling to avoid 413 on valid submissions while still bounding abuse.
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Session configuration (only for web clients, not React Native)
if (process.env.NODE_ENV !== 'react-native') {
  app.use(session({
    secret: (() => {
      try {
        return require('./lib/runtimeSecrets').getSessionSecret();
      } catch (e) {
        console.error(e.message || e);
        return process.env.SESSION_SECRET || 'your-secret-key';
      }
    })(),
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
const rideRequestRoutes = require('./routes/ride-requests');
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
const webrtcRoutes = require('./routes/webrtc');
const { deductDriverCommissionForRide } = require('./lib/driverCommission');
const { normalizeRideTypeKey, rideTypesMatch } = require('./utils/rideFarePricing');
const { stampRideStart, stampRideComplete, durationMinutesForRideDoc } = require('./lib/rideDuration');
const {
  getJwtSecret,
  assertRuntimeSecretsOrExit,
  socketUserId,
} = require('./lib/runtimeSecrets');

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/ride-requests', rideRequestRoutes);
app.use('/api/webrtc', webrtcRoutes);
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

// Public legal pages (Play Store requires a publicly accessible privacy policy URL)
app.get('/privacy-policy', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>GB Rides – Privacy Policy</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f172a;color:#e2e8f0;line-height:1.7;padding:24px 16px}
    .wrap{max-width:720px;margin:0 auto}
    h1{font-size:1.8rem;margin-bottom:8px;color:#fff}
    .updated{font-size:.85rem;color:#94a3b8;margin-bottom:24px}
    h2{font-size:1.15rem;margin-top:24px;margin-bottom:8px;color:#38bdf8}
    p,ul{margin-bottom:12px;font-size:.95rem;color:#cbd5e1}
    ul{padding-left:20px}
    li{margin-bottom:4px}
    a{color:#38bdf8}
    .footer{margin-top:40px;padding-top:16px;border-top:1px solid #1e293b;font-size:.8rem;color:#64748b}
  </style>
</head>
<body>
<div class="wrap">
  <h1>Privacy Policy</h1>
  <p class="updated">Last updated: May 2026</p>

  <p>GB Rides ("we", "us", "our") operates the GB Rides ride-booking mobile application for Gilgit and Gilgit-Baltistan. This policy explains what personal data we collect, how we use it, and the choices you have when you use our app as a rider or driver.</p>

  <h2>1. Information We Collect</h2>
  <ul>
    <li><strong>Account information</strong> – name, email address, phone number, profile photo, and account type (rider or driver).</li>
    <li><strong>Trip and booking data</strong> – pickup and drop-off locations, route details, timestamps, offered and accepted fares, transport mode, ride status, and rider/driver identifiers.</li>
    <li><strong>Location data</strong> – GPS coordinates when you use the map, request a ride, receive driver offers, or take an active trip (for pickup accuracy, routing, navigation, and safety).</li>
    <li><strong>Driver offers and messages</strong> – fare offers, ride chat messages, and related in-app communications during a booking.</li>
    <li><strong>Notifications</strong> – device push tokens to send ride updates, driver offers, and important service alerts (you can manage notification permissions on your device).</li>
    <li><strong>Audio</strong> – microphone access is used only for in-app voice calls between rider and driver during a trip. We do not record or store call audio.</li>
    <li><strong>Device and diagnostics</strong> – app version, operating system, and technical logs to maintain reliability and fix issues.</li>
  </ul>

  <h2>2. How We Use Your Data</h2>
  <ul>
    <li>Show your position on the map and help you select pickup and destination points.</li>
    <li>Match riders with nearby drivers and deliver real-time fare offers.</li>
    <li>Calculate suggested fares, process bookings, and provide live trip tracking.</li>
    <li>Maintain trip history and support rebooking from past destinations.</li>
    <li>Send notifications about offers, ride status, and account activity.</li>
    <li>Provide customer support, improve safety, and prevent misuse of the service.</li>
    <li>Comply with legal obligations where required.</li>
  </ul>

  <h2>3. Data Sharing</h2>
  <p>During a ride, the rider and driver can see information needed to complete the trip (such as name, contact details, vehicle information, pickup/drop-off, and live location). We do <strong>not</strong> sell your personal data.</p>
  <p>We may share limited data with:</p>
  <ul>
    <li><strong>Map services</strong> (for example Google Maps) to display maps, geocoding, and directions.</li>
    <li><strong>Cloud infrastructure providers</strong> that host our servers and databases under data-processing safeguards.</li>
    <li><strong>Law enforcement or regulators</strong> when we are legally required to do so.</li>
  </ul>

  <h2>4. Your Rights and Account Deletion</h2>
  <ul>
    <li>Update or correct certain profile details from within the app.</li>
    <li>Permanently delete your account from <strong>Profile → Delete account</strong> in the GB Rides app (your password is required). You cannot delete your account while a trip is in progress.</li>
    <li><strong>After you delete your account, all data associated with your account is permanently removed from our systems.</strong> This includes your profile, trip and ride-request history, ride chat messages, support tickets, driver profile and wallet records (if you are a driver), verification codes linked to your email or phone, and other personal data tied to your account.</li>
    <li>Contact us at <a href="mailto:i.mesumabbas@gmail.com">i.mesumabbas@gmail.com</a> if you have questions about your data or need help with account deletion.</li>
  </ul>

  <h2>5. Children's Privacy</h2>
  <p>GB Rides is not intended for users under the age of 18. We do not knowingly collect data from children.</p>

  <h2>6. Security</h2>
  <p>We use HTTPS encryption, hashed passwords, and secure authentication to protect your data. While no method is 100% secure, we take reasonable precautions to safeguard your information.</p>

  <h2>7. Changes to This Policy</h2>
  <p>We may update this policy from time to time. Changes will be posted on this page with an updated revision date.</p>

  <h2>8. Contact</h2>
  <p>If you have questions about this policy, please contact us at <a href="mailto:i.mesumabbas@gmail.com">i.mesumabbas@gmail.com</a>.</p>

  <div class="footer">
    &copy; ${new Date().getFullYear()} GB Rides – Gilgit-Baltistan, Pakistan
  </div>
</div>
</body>
</html>`);
});

// Play Store: public account-deletion instructions (Data safety → Delete account URL)
app.get('/delete-account', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>GB Rides – Delete Your Account</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f172a;color:#e2e8f0;line-height:1.7;padding:24px 16px}
    .wrap{max-width:720px;margin:0 auto}
    h1{font-size:1.8rem;margin-bottom:8px;color:#fff}
    .updated{font-size:.85rem;color:#94a3b8;margin-bottom:24px}
    h2{font-size:1.15rem;margin-top:24px;margin-bottom:8px;color:#38bdf8}
    p,ul,ol{margin-bottom:12px;font-size:.95rem;color:#cbd5e1}
    ul,ol{padding-left:20px}
    li{margin-bottom:6px}
    a{color:#38bdf8}
    .footer{margin-top:40px;padding-top:16px;border-top:1px solid #1e293b;font-size:.8rem;color:#64748b}
  </style>
</head>
<body>
<div class="wrap">
  <h1>GB Rides – Delete your account</h1>
  <p class="updated">Last updated: May 2026</p>

  <p>You can permanently delete your <strong>GB Rides</strong> account and remove associated personal data from our systems using the steps below.</p>

  <h2>Delete your account in the app (recommended)</h2>
  <ol>
    <li>Open the <strong>GB Rides</strong> app and sign in.</li>
    <li>Go to <strong>Profile</strong> (menu or profile icon).</li>
    <li>Tap <strong>Delete account</strong>.</li>
    <li>Enter your <strong>password</strong> and confirm deletion.</li>
  </ol>
  <p>You cannot delete your account while a trip is in progress. Finish or cancel the trip first, then try again.</p>

  <h2>What data is deleted</h2>
  <p>After you delete your account, <strong>all data associated with your account is permanently removed</strong> from our systems, including:</p>
  <ul>
    <li>Your profile (name, email, phone, profile photo)</li>
    <li>Trip and ride-request history</li>
    <li>Ride chat messages</li>
    <li>Support tickets and messages linked to your account</li>
    <li>Driver profile and wallet records (if you registered as a driver)</li>
    <li>Email and phone verification codes linked to your account</li>
    <li>Other personal data tied to your GB Rides account</li>
  </ul>

  <h2>Request help by email</h2>
  <p>If you cannot access the app, email <a href="mailto:i.mesumabbas@gmail.com">i.mesumabbas@gmail.com</a> from the address on your account. Include your name and phone number so we can verify your request and complete deletion.</p>

  <p>See also our <a href="/privacy-policy">Privacy Policy</a>.</p>

  <div class="footer">
    &copy; ${new Date().getFullYear()} GB Rides – Gilgit-Baltistan, Pakistan
  </div>
</div>
</body>
</html>`);
});

app.get('/terms-of-service', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>GB Rides – Terms of Service</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f172a;color:#e2e8f0;line-height:1.7;padding:24px 16px}
    .wrap{max-width:720px;margin:0 auto}
    h1{font-size:1.8rem;margin-bottom:8px;color:#fff}
    .updated{font-size:.85rem;color:#94a3b8;margin-bottom:24px}
    h2{font-size:1.15rem;margin-top:24px;margin-bottom:8px;color:#38bdf8}
    p,ul{margin-bottom:12px;font-size:.95rem;color:#cbd5e1}
    ul{padding-left:20px}
    li{margin-bottom:4px}
    a{color:#38bdf8}
    .footer{margin-top:40px;padding-top:16px;border-top:1px solid #1e293b;font-size:.8rem;color:#64748b}
  </style>
</head>
<body>
<div class="wrap">
  <h1>Terms of Service</h1>
  <p class="updated">Last updated: April 2026</p>

  <p>By using GB Rides you agree to these terms. If you do not agree, do not use the app.</p>

  <h2>1. Eligibility</h2>
  <p>You must be at least 18 years old and legally able to enter contracts in Pakistan.</p>

  <h2>2. Account</h2>
  <p>You are responsible for keeping your credentials secure. One account per person.</p>

  <h2>3. Rides &amp; Fares</h2>
  <p>Riders and drivers negotiate fares through the app. GB Rides may charge a service commission. All fares are in Pakistani Rupees (PKR).</p>

  <h2>4. Cancellations</h2>
  <p>Repeated no-show cancellations by drivers may result in temporary penalties or account suspension as described in our driver policies.</p>

  <h2>5. Prohibited Conduct</h2>
  <ul>
    <li>Harassment, threats, or discrimination toward any user.</li>
    <li>Impersonation or providing false information.</li>
    <li>Using the app for any illegal purpose.</li>
  </ul>

  <h2>6. Liability</h2>
  <p>GB Rides connects riders with independent drivers. We are not a transportation provider and are not liable for incidents during rides beyond what the law requires.</p>

  <h2>7. Termination</h2>
  <p>We may suspend or terminate accounts that violate these terms.</p>

  <h2>8. Changes</h2>
  <p>We may update these terms. Continued use after changes constitutes acceptance.</p>

  <h2>9. Contact</h2>
  <p>Questions? <a href="mailto:i.mesumabbas@gmail.com">i.mesumabbas@gmail.com</a></p>

  <div class="footer">
    &copy; ${new Date().getFullYear()} GB Rides – Gilgit-Baltistan, Pakistan
  </div>
</div>
</body>
</html>`);
});

// Health check endpoint (mongo readyState: 0=disconnected 1=connected 2=connecting 3=disconnecting)
app.get('/api/health', (req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  res.status(mongoOk ? 200 : 503).json({
    status: mongoOk ? 'OK' : 'degraded',
    message: mongoOk ? 'Server is running' : 'MongoDB not connected',
    mongo: { ready: mongoOk, readyState: mongoose.connection.readyState },
  });
});

// Payload-too-large should return JSON so mobile clients can show a clear message.
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'PAYLOAD_TOO_LARGE',
      message:
        'Uploaded images are too large. Please choose smaller/compressed photos and try again.',
    });
  }
  return next(err);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 8080;

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO — same origin policy as HTTP CORS (null Origin allowed for RN)
const io = socketIo(server, {
  cors: {
    origin: (origin, callback) => {
      if (isCorsOriginAllowed(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ["GET", "POST"]
  }
});

app.set('io', io);

const jwt = require('jsonwebtoken');

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

async function getRideParticipantPair(rideRequestId) {
  const rid = rideRequestId != null ? String(rideRequestId) : '';
  if (!rid) return null;
  let pair = ridePresenceParticipants.get(rid);
  if (pair?.riderId && pair?.driverId) return pair;
  const RideRequest = require('./models/RideRequest');
  const rr = await RideRequest.findById(rid).select('rider acceptedBy').lean();
  if (!rr?.rider || !rr.acceptedBy) return null;
  pair = { riderId: String(rr.rider), driverId: String(rr.acceptedBy) };
  ridePresenceParticipants.set(rid, pair);
  return pair;
}

async function notifyRidePresence(ioInstance, rideRequestId) {
  const rid = rideRequestId != null ? String(rideRequestId) : '';
  if (!rid) return;
  const pair = await getRideParticipantPair(rid);
  if (!pair) return;
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

  // Handle user authentication — JWT required; identity from token only (P0)
  socket.on('authenticate', (data) => {
    const { userType: claimedType, token: rawToken } = data || {};
    if (!rawToken || typeof rawToken !== 'string') {
      socket.emit('auth_error', { message: 'Authentication required' });
      console.warn('Socket authenticate: missing token');
      return;
    }

    let payload;
    try {
      payload = jwt.verify(rawToken, getJwtSecret());
    } catch {
      socket.emit('auth_error', { message: 'Invalid or expired token' });
      console.warn('Socket authenticate: invalid token');
      return;
    }

    const userId = payload?.id != null ? String(payload.id) : '';
    if (!userId) {
      socket.emit('auth_error', { message: 'Invalid token payload' });
      return;
    }

    const tokenType = payload.userType === 'driver' ? 'driver' : 'rider';
    // Prefer JWT userType; fall back to claimed only if JWT has no userType (admin tokens won't use this path)
    const userType =
      payload.userType === 'driver' || payload.userType === 'rider'
        ? payload.userType
        : claimedType === 'driver'
          ? 'driver'
          : 'rider';

    const v = Number(payload.sv);
    socket.data.sessionVersion = Number.isFinite(v) ? v : 0;
    socket.data.userId = userId;
    socket.data.userType = userType === 'driver' ? 'driver' : tokenType;

    activeConnections.set(userId, socket.id);
    const room = userSocketRoom(userId);
    if (room) socket.join(room);

    if (socket.data.userType === 'driver') {
      driverConnections.set(userId, socket.id);
      console.log(`🚗 Driver ${userId} connected`);
    } else {
      console.log(`👤 Rider ${userId} connected`);
    }

    socket.emit('authenticated', { userId, userType: socket.data.userType });

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

  // Handle driver response to ride request — identity from JWT only (ignore client driverId)
  socket.on('driver_response', async (data) => {
    try {
      const actorId = socketUserId(socket);
      if (!actorId) {
        socket.emit('error', { message: 'Not authenticated' });
        return;
      }
      const driverId = actorId;
      const { rideRequestId, action, counterOffer } = data || {};

      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId);

      if (!rideRequest) {
        socket.emit('error', { message: 'Ride request not found' });
        return;
      }

      if (!['searching', 'pending'].includes(rideRequest.status)) {
        socket.emit('error', { message: 'Ride request is no longer available' });
        return;
      }

      if (rideRequest.expiresAt && new Date(rideRequest.expiresAt).getTime() < Date.now()) {
        const { markRideRequestExpiredIfNeeded } = require('./lib/expireStaleRideRequests');
        await markRideRequestExpiredIfNeeded(rideRequest);
        socket.emit('error', { message: 'Ride request has expired' });
        return;
      }

      const Driver = require('./models/Driver');
      const driverDoc = await Driver.findOne({ user: driverId }).lean();
      if (!driverDoc) {
        socket.emit('error', { message: 'Driver profile not found' });
        return;
      }
      if (driverDoc?.accountDeactivatedUntil && new Date(driverDoc.accountDeactivatedUntil).getTime() > Date.now()) {
        socket.emit('error', { message: 'Driver account is temporarily deactivated' });
        return;
      }
      const approved = driverDoc.isApproved === true || driverDoc.approvalStatus === 'approved';
      if (!approved) {
        socket.emit('error', { message: 'Driver account is not approved' });
        return;
      }

      const driverRideType = normalizeRideTypeKey(
        driverDoc?.vehicleInfo?.rideType || driverDoc?.vehicleInfo?.vehicleType || 'ride_mini'
      );
      if (!rideTypesMatch(rideRequest.vehicleType, driverRideType)) {
        socket.emit('error', { message: 'This ride request is not available for your vehicle type' });
        return;
      }

      const { getDriverMinimumWalletPkr } = require('./lib/walletSettings');
      const minimum = await getDriverMinimumWalletPkr();
      const bal = Number(driverDoc?.wallet?.balance || 0);
      if (bal < Number(minimum || 0)) {
        socket.emit('error', { message: `Insufficient wallet balance. Minimum required is ${minimum} PKR` });
        return;
      }

      if (action === 'accept') {
        // Driver accept should only send a fare offer. Final assignment happens on rider acceptance.
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

        await scheduleFareResponseTimeout(io, rideRequestId, driverId);

        socket.emit('response_success', {
          message: 'Offer sent successfully. Waiting for rider response...',
          rideRequestId,
          waitingForRider: true
        });
      } else if (action === 'negotiate') {
        if (Array.isArray(rideRequest.availableDrivers)) {
          rideRequest.availableDrivers.forEach((availableDriver) => {
            if (availableDriver.driver.toString() === driverId) {
              availableDriver.counterOffer = counterOffer;
              availableDriver.status = 'counter_offered';
              availableDriver.respondedAt = new Date();
            }
          });
        }

        await rideRequest.save();

        emitToUser(io, rideRequest.rider, 'ride_counter_offer', {
          rideRequestId,
          driverId,
          counterOffer,
          message: 'Driver has made a counter offer'
        });

        socket.emit('response_success', { message: 'Counter offer sent successfully' });
      } else {
        socket.emit('error', { message: 'Invalid action' });
      }
    } catch (error) {
      console.error('Error handling driver response:', error);
      socket.emit('error', { message: 'Failed to process response' });
    }
  });

  // Handle fare offer from driver to rider (auth + status + type guards like HTTP /respond)
  socket.on('fare_offer', async (data) => {
    try {
      const actorId = socketUserId(socket);
      if (!actorId) {
        socket.emit('error', { message: 'Not authenticated' });
        return;
      }
      const { rideRequestId, driverName, driverRating, fareAmount, arrivalTime, vehicleInfo } = data || {};
      const driverId = actorId;

      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId);
      
      if (!rideRequest) {
        socket.emit('error', { message: 'Ride request not found' });
        return;
      }

      if (!['searching', 'pending'].includes(rideRequest.status)) {
        socket.emit('error', { message: 'Ride request is no longer available' });
        return;
      }

      if (rideRequest.expiresAt && new Date(rideRequest.expiresAt).getTime() < Date.now()) {
        const { markRideRequestExpiredIfNeeded } = require('./lib/expireStaleRideRequests');
        await markRideRequestExpiredIfNeeded(rideRequest);
        socket.emit('error', { message: 'Ride request has expired' });
        return;
      }

      const fare = Number(fareAmount);
      if (!Number.isFinite(fare) || fare <= 0) {
        socket.emit('error', { message: 'Invalid fare amount' });
        return;
      }
      const suggested = Number(rideRequest.suggestedPrice || rideRequest.requestedPrice || 0);
      const maxFare = suggested > 0 ? Math.max(suggested * 5, suggested + 5000) : 200000;
      if (fare > maxFare) {
        socket.emit('error', { message: 'Fare amount is too high' });
        return;
      }

      const Driver = require('./models/Driver');
      const driverDoc = await Driver.findOne({ user: driverId }).lean();
      if (!driverDoc) {
        socket.emit('error', { message: 'Driver profile not found' });
        return;
      }
      if (driverDoc?.accountDeactivatedUntil && new Date(driverDoc.accountDeactivatedUntil).getTime() > Date.now()) {
        socket.emit('error', { message: 'Driver account is temporarily deactivated' });
        return;
      }
      const approved = driverDoc.isApproved === true || driverDoc.approvalStatus === 'approved';
      if (!approved) {
        socket.emit('error', { message: 'Driver account is not approved' });
        return;
      }

      const driverRideType = normalizeRideTypeKey(
        driverDoc?.vehicleInfo?.rideType || driverDoc?.vehicleInfo?.vehicleType || 'ride_mini'
      );
      if (!rideTypesMatch(rideRequest.vehicleType, driverRideType)) {
        socket.emit('error', { message: 'This ride request is not available for your vehicle type' });
        return;
      }

      // Enforce minimum wallet balance before allowing offers to reach the rider.
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
        fareAmount: fare,
        arrivalTime,
        driverDistanceKm,
        vehicleInfo: enriched.vehicleInfo || vehicleInfo || 'Vehicle',
        vehicleName: enriched.vehicleName || '',
        driverPhoto: enriched.driverPhoto || '',
      };

      rideRequest.fareOffers = Array.isArray(rideRequest.fareOffers) ? rideRequest.fareOffers : [];
      rideRequest.fareOffers.push({
        driver: driverId,
        ...offerPayload,
        offeredAt: new Date(),
        status: 'pending'
      });

      await rideRequest.save();

      emitToUser(io, rideRequest.rider, 'fare_offer', {
        rideRequestId,
        driverId,
        ...offerPayload,
        timestamp: Date.now(),
      });
      console.log(`💰 Fare offer sent to rider ${rideRequest.rider} from driver ${driverId}`);

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
      const { rideRequestId, eventId } = data || {};
      if (isDuplicateEvent(eventId)) {
        if (typeof ack === 'function') ack({ ok: true, duplicate: true, eventId });
        return;
      }
      const actorId = socketUserId(socket);
      if (!actorId) {
        socket.emit('error', { message: 'Not authenticated' });
        if (typeof ack === 'function') ack({ ok: false, error: 'Not authenticated' });
        return;
      }
      if (!rideRequestId) {
        socket.emit('error', { message: 'Ride request not found' });
        if (typeof ack === 'function') ack({ ok: false, error: 'Ride request not found' });
        return;
      }

      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findOneAndUpdate(
        {
          _id: rideRequestId,
          status: { $nin: ['cancelled', 'completed'] },
          $or: [{ rider: actorId }, { acceptedBy: actorId }],
        },
        { $set: { status: 'cancelled', cancelledAt: new Date() } },
        { new: true }
      );

      if (!rideRequest) {
        const existing = await RideRequest.findById(rideRequestId).select('status rider acceptedBy').lean();
        if (existing && ['cancelled', 'completed'].includes(existing.status)) {
          socket.emit('ride_cancelled_ack', { rideRequestId, status: 'ok', alreadyEnded: true });
          markEventProcessed(eventId);
          if (typeof ack === 'function') ack({ ok: true, eventId, alreadyEnded: true });
          return;
        }
        socket.emit('error', { message: 'Not authorized to cancel this ride request' });
        if (typeof ack === 'function') ack({ ok: false, error: 'Not authorized' });
        return;
      }

      const rid = String(rideRequestId);
      const canceller = String(actorId);
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
      const { rideRequestId, driverId, action, eventId } = data || {};
      if (isDuplicateEvent(eventId)) {
        if (typeof ack === 'function') ack({ ok: true, duplicate: true, eventId });
        return;
      }

      const actorId = socketUserId(socket);
      if (!actorId) {
        socket.emit('error', { message: 'Not authenticated' });
        if (typeof ack === 'function') ack({ ok: false, error: 'Not authenticated' });
        return;
      }
      
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId);
      
      if (!rideRequest) {
        socket.emit('error', { message: 'Ride request not found' });
        return;
      }

      if (String(rideRequest.rider) !== actorId) {
        socket.emit('error', { message: 'Not authorized to respond to this fare offer' });
        if (typeof ack === 'function') ack({ ok: false, error: 'Not authorized' });
        return;
      }
      const riderId = actorId;

      // Reject if the ride request has expired — persist so admin Live Rides cannot stay "live"
      if (rideRequest.expiresAt && new Date(rideRequest.expiresAt).getTime() < Date.now()) {
        const { markRideRequestExpiredIfNeeded } = require('./lib/expireStaleRideRequests');
        await markRideRequestExpiredIfNeeded(rideRequest);
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

      if (action === 'accept') {
        const agreedFare = Number(targetOffer.fareAmount);
        const claimSet = {
          status: 'accepted',
          acceptedBy: targetOffer.driver,
          acceptedAt: new Date(),
        };
        if (Number.isFinite(agreedFare) && agreedFare > 0) {
          claimSet.requestedPrice = agreedFare;
        }

        const claimed = await RideRequest.findOneAndUpdate(
          {
            _id: rideRequestId,
            status: { $in: ['searching', 'pending'] },
          },
          { $set: claimSet },
          { new: true }
        );

        if (!claimed) {
          socket.emit('error', { message: 'Ride request is no longer available for fare responses' });
          if (typeof ack === 'function') ack({ ok: false, error: 'Ride no longer available' });
          return;
        }

        const offerOnClaimed = (claimed.fareOffers || []).find(
          (o) => String(o.driver) === String(targetOffer.driver) && o.status === 'pending'
        ) || (claimed.fareOffers || []).find((o) => String(o.driver) === String(targetOffer.driver));

        if (offerOnClaimed) {
          offerOnClaimed.status = 'accepted';
          offerOnClaimed.respondedAt = new Date();
        }
        (claimed.fareOffers || []).forEach((offer) => {
          if (String(offer.driver) !== String(targetOffer.driver) && offer.status === 'pending') {
            offer.status = 'rejected';
            offer.respondedAt = new Date();
          }
        });
        await claimed.save();
        await ensureRideRoutePolylineSaved(claimed);

        emitToUser(io, targetOffer.driver, 'fare_response', {
          rideRequestId,
          riderId,
          action,
          timestamp: Date.now()
        });
        console.log(`💰 Fare response sent to driver ${targetOffer.driver} from rider ${riderId}: ${action}`);

        clearFareResponseTimeout(rideRequestId, targetOffer.driver);
        const otherDrivers = new Set((claimed.fareOffers || []).map((o) => String(o.driver)));
        otherDrivers.forEach((d) => clearFareResponseTimeout(rideRequestId, d));

        emitToUser(io, riderId, 'fare_response_confirmed', {
          rideRequestId,
          action,
          message: `Fare offer ${action}ed successfully`
        });

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

        socket.emit('fare_response_sent', { message: `Fare offer ${action}ed successfully` });
        markEventProcessed(eventId);
        if (typeof ack === 'function') ack({ ok: true, eventId });
        return;
      }

      // Decline / reject path
      targetOffer.status = 'rejected';
      targetOffer.respondedAt = new Date();
      await rideRequest.save();

      emitToUser(io, targetOffer.driver, 'fare_response', {
        rideRequestId,
        riderId,
        action,
        timestamp: Date.now()
      });
      console.log(`💰 Fare response sent to driver ${targetOffer.driver} from rider ${riderId}: ${action}`);

      clearFareResponseTimeout(rideRequestId, targetOffer.driver);

      emitToUser(io, riderId, 'fare_response_confirmed', {
        rideRequestId,
        action,
        message: `Fare offer ${action}ed successfully`
      });

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
      const { rideRequestId, driverId } = data || {};
      const actorId = socketUserId(socket);
      if (!actorId) {
        socket.emit('error', { message: 'Not authenticated' });
        return;
      }
      
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId);
      
      if (!rideRequest) {
        socket.emit('error', { message: 'Ride request not found' });
        return;
      }

      if (String(rideRequest.rider) !== actorId) {
        socket.emit('error', { message: 'Not authorized' });
        return;
      }

      if (!['searching', 'pending'].includes(rideRequest.status)) {
        socket.emit('error', { message: 'Ride request is no longer available' });
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

      const agreed = Number(counterOfferDriver.counterOffer);
      const claimed = await RideRequest.findOneAndUpdate(
        { _id: rideRequestId, status: { $in: ['searching', 'pending'] } },
        {
          $set: {
            status: 'accepted',
            acceptedBy: driverId,
            requestedPrice: Number.isFinite(agreed) && agreed > 0 ? agreed : rideRequest.requestedPrice,
          },
        },
        { new: true }
      );
      if (!claimed) {
        socket.emit('error', { message: 'Ride request is no longer available' });
        return;
      }
      await ensureRideRoutePolylineSaved(claimed);

      // Notify driver (use room-based delivery for reconnect safety)
      emitToUser(io, driverId, 'counter_offer_accepted', {
        rideRequestId,
        message: 'Your counter offer has been accepted'
      });

      // Notify rider
      emitToUser(io, claimed.rider, 'counter_offer_accepted', {
        rideRequestId,
        message: 'Counter offer accepted successfully'
      });

      // Notify other drivers
      (claimed.availableDrivers || []).forEach(availableDriver => {
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
      const { rideRequestId, latitude, longitude, eventId } = data || {};
      if (isDuplicateEvent(eventId)) {
        if (typeof ack === 'function') ack({ ok: true, duplicate: true, eventId });
        return;
      }
      const actorId = socketUserId(socket);
      if (!actorId) {
        socket.emit('error', { message: 'Not authenticated' });
        if (typeof ack === 'function') ack({ ok: false, error: 'Not authenticated' });
        return;
      }
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId);
      if (!rideRequest) {
        socket.emit('error', { message: 'Ride request not found' });
        return;
      }
      if (String(rideRequest.rider) !== actorId) {
        socket.emit('error', { message: 'Not authorized' });
        if (typeof ack === 'function') ack({ ok: false, error: 'Not authorized' });
        return;
      }
      if (!['accepted', 'in_progress'].includes(rideRequest.status)) {
        socket.emit('error', { message: 'Ride is not active' });
        if (typeof ack === 'function') ack({ ok: false, error: 'Ride is not active' });
        return;
      }
      // Notify the driver that rider is at pickup
      const assignedDriverId = (rideRequest.acceptedBy || '').toString();
      if (!rideRequest.riderArrivedAt) {
        rideRequest.riderArrivedAt = new Date();
        await rideRequest.save();
      }
      const payload = { rideRequestId, riderId: actorId };
      if (typeof latitude === 'number' && typeof longitude === 'number') {
        payload.riderLocation = { latitude, longitude };
      }
      emitToUser(io, assignedDriverId, 'rider_at_pickup', payload);
      console.log(`📍 Rider ${actorId} confirmed at pickup, notifying driver ${assignedDriverId}`);
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
  /** Match client GPS cadence (~4s). Cache ride pair so ticks do not hit Mongo. */
  const LIVE_LOC_THROTTLE_MS = 2000;

  socket.on('ride_live_location', async (data) => {
    try {
      const actorId = socketUserId(socket);
      if (!actorId) return;
      const { rideRequestId, senderType, latitude, longitude, heading } = data || {};
      if (!rideRequestId || !senderType) return;
      if (typeof latitude !== 'number' || typeof longitude !== 'number') return;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

      const throttleKey = `${rideRequestId}:${actorId}`;
      const now = Date.now();
      const lastEmit = liveLocLastEmit.get(throttleKey) || 0;
      if (now - lastEmit < LIVE_LOC_THROTTLE_MS) return;
      liveLocLastEmit.set(throttleKey, now);

      const pair = await getRideParticipantPair(rideRequestId);
      if (!pair) return;

      const liveRiderId = pair.riderId;
      const liveDriverId = pair.driverId;
      if (actorId !== liveRiderId && actorId !== liveDriverId) return;

      const resolvedType =
        actorId === liveDriverId ? 'driver' : actorId === liveRiderId ? 'rider' : senderType;

      const payload = {
        rideRequestId: String(rideRequestId),
        senderType: resolvedType,
        latitude,
        longitude,
        timestamp: now,
        ...(typeof heading === 'number' && Number.isFinite(heading) ? { heading } : {}),
      };

      if (resolvedType === 'rider') {
        emitToUser(io, liveDriverId, 'ride_live_location', payload);
      } else if (resolvedType === 'driver') {
        emitToUser(io, liveRiderId, 'ride_live_location', payload);
      }
    } catch (err) {
      console.error('Error handling ride_live_location:', err);
    }
  });

  // Real-time chat between rider and assigned driver (persisted for admin review)
  socket.on('ride_chat_message', async (data) => {
    try {
      const actorId = socketUserId(socket);
      if (!actorId) {
        socket.emit('error', { message: 'Not authenticated' });
        return;
      }
      const { rideRequestId, text, timestamp } = data || {};
      if (!rideRequestId || typeof text !== 'string') {
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

      if (actorId !== riderId && actorId !== driverId) {
        socket.emit('error', { message: 'Not authorized to chat on this ride' });
        return;
      }

      const senderType = actorId === riderId ? 'rider' : 'driver';
      const recipientId = senderType === 'rider' ? driverId : riderId;

      const payload = {
        rideRequestId,
        senderId: actorId,
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
      const { rideRequestId, timestamp, eventId } = data || {};
      if (isDuplicateEvent(eventId)) {
        if (typeof ack === 'function') ack({ ok: true, duplicate: true, eventId });
        return;
      }
      const actorId = socketUserId(socket);
      if (!actorId || !rideRequestId) return;
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy').lean();
      if (!rideRequest) return;

      const riderId = (rideRequest.rider || '').toString();
      const driverId = (rideRequest.acceptedBy || '').toString();
      if (!riderId || !driverId) return;
      if (actorId !== riderId && actorId !== driverId) return;

      const callerType = actorId === riderId ? 'rider' : 'driver';
      const recipientId = callerType === 'rider' ? driverId : riderId;

      const payload = {
        rideRequestId,
        callerId: actorId,
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
      const { rideRequestId, action, timestamp, eventId } = data || {};
      if (isDuplicateEvent(eventId)) {
        if (typeof ack === 'function') ack({ ok: true, duplicate: true, eventId });
        return;
      }
      const actorId = socketUserId(socket);
      if (!actorId || !rideRequestId || !action) return;
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy').lean();
      if (!rideRequest) return;

      const riderId = (rideRequest.rider || '').toString();
      const driverId = (rideRequest.acceptedBy || '').toString();
      if (actorId !== riderId && actorId !== driverId) return;
      const responderType = actorId === riderId ? 'rider' : 'driver';
      const recipientId = responderType === 'rider' ? driverId : riderId;

      const payload = {
        rideRequestId,
        responderId: actorId,
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
      const { rideRequestId, timestamp, eventId } = data || {};
      if (isDuplicateEvent(eventId)) {
        if (typeof ack === 'function') ack({ ok: true, duplicate: true, eventId });
        return;
      }
      const actorId = socketUserId(socket);
      if (!actorId || !rideRequestId) return;
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy').lean();
      if (!rideRequest) return;

      const riderId = (rideRequest.rider || '').toString();
      const driverId = (rideRequest.acceptedBy || '').toString();
      if (actorId !== riderId && actorId !== driverId) return;
      const userType = actorId === riderId ? 'rider' : 'driver';
      const recipientId = userType === 'rider' ? driverId : riderId;

      const payload = {
        rideRequestId,
        userId: actorId,
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
      const actorId = socketUserId(socket);
      if (!actorId) return;
      const { rideRequestId, offer } = data || {};
      if (!rideRequestId || !offer) return;
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy').lean();
      if (!rideRequest) return;
      const riderId = (rideRequest.rider || '').toString();
      const driverId = (rideRequest.acceptedBy || '').toString();
      if (actorId !== riderId && actorId !== driverId) return;
      const fromType = actorId === riderId ? 'rider' : 'driver';
      const recipientId = fromType === 'rider' ? driverId : riderId;
      emitToUser(io, recipientId, 'ride_call_offer', { ...data, fromId: actorId, fromType });
    } catch (err) {
      console.error('Error handling ride_call_offer:', err);
    }
  });

  // WebRTC answer relay
  socket.on('ride_call_answer', async (data) => {
    try {
      const actorId = socketUserId(socket);
      if (!actorId) return;
      const { rideRequestId, answer } = data || {};
      if (!rideRequestId || !answer) return;
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy').lean();
      if (!rideRequest) return;
      const riderId = (rideRequest.rider || '').toString();
      const driverId = (rideRequest.acceptedBy || '').toString();
      if (actorId !== riderId && actorId !== driverId) return;
      const fromType = actorId === riderId ? 'rider' : 'driver';
      const recipientId = fromType === 'rider' ? driverId : riderId;
      emitToUser(io, recipientId, 'ride_call_answer', { ...data, fromId: actorId, fromType });
    } catch (err) {
      console.error('Error handling ride_call_answer:', err);
    }
  });

  // WebRTC ICE relay
  socket.on('ride_call_ice_candidate', async (data) => {
    try {
      const actorId = socketUserId(socket);
      if (!actorId) return;
      const { rideRequestId, candidate } = data || {};
      if (!rideRequestId || !candidate) return;
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findById(rideRequestId).select('rider acceptedBy').lean();
      if (!rideRequest) return;
      const riderId = (rideRequest.rider || '').toString();
      const driverId = (rideRequest.acceptedBy || '').toString();
      if (actorId !== riderId && actorId !== driverId) return;
      const fromType = actorId === riderId ? 'rider' : 'driver';
      const recipientId = fromType === 'rider' ? driverId : riderId;
      emitToUser(io, recipientId, 'ride_call_ice_candidate', { ...data, fromId: actorId, fromType });
    } catch (err) {
      console.error('Error handling ride_call_ice_candidate:', err);
    }
  });

  // Handle driver starting the ride
  socket.on('start_ride', async (data, ack) => {
    try {
      const { rideRequestId, eventId } = data || {};
      if (isDuplicateEvent(eventId)) {
        if (typeof ack === 'function') ack({ ok: true, duplicate: true, eventId });
        return;
      }
      const actorId = socketUserId(socket);
      if (!actorId) {
        socket.emit('error', { message: 'Not authenticated' });
        if (typeof ack === 'function') ack({ ok: false, error: 'Not authenticated' });
        return;
      }
      const RideRequest = require('./models/RideRequest');
      const rideRequest = await RideRequest.findOneAndUpdate(
        {
          _id: rideRequestId,
          status: 'accepted',
          acceptedBy: actorId,
        },
        {
          $set: {
            status: 'in_progress',
            startedAt: new Date(),
          },
        },
        { new: true }
      );

      if (!rideRequest) {
        const existing = await RideRequest.findById(rideRequestId).select('status acceptedBy').lean();
        if (
          existing &&
          existing.status === 'in_progress' &&
          String(existing.acceptedBy) === actorId
        ) {
          markEventProcessed(eventId);
          socket.emit('ride_started_ack', { rideRequestId });
          if (typeof ack === 'function') ack({ ok: true, eventId, duplicate: true });
          return;
        }
        socket.emit('error', { message: 'Not authorized to start this ride' });
        if (typeof ack === 'function') ack({ ok: false, error: 'Not authorized' });
        return;
      }

      stampRideStart(rideRequest);
      if (!rideRequest.startedAt) {
        rideRequest.startedAt = new Date();
        await rideRequest.save();
      }

      emitToUser(io, rideRequest.rider, 'ride_started', { rideRequestId, driverId: actorId });
      console.log(`🚗 Ride ${rideRequestId} started by driver ${actorId}`);
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
      const { rideRequestId, eventId } = data || {};
      if (isDuplicateEvent(eventId)) {
        if (typeof ack === 'function') ack({ ok: true, duplicate: true, eventId });
        return;
      }
      const actorId = socketUserId(socket);
      if (!actorId) {
        socket.emit('error', { message: 'Not authenticated' });
        if (typeof ack === 'function') ack({ ok: false, error: 'Not authenticated' });
        return;
      }
      const RideRequest = require('./models/RideRequest');
      const Ride = require('./models/Ride');
      const rideRequest = await RideRequest.findOneAndUpdate(
        {
          _id: rideRequestId,
          status: 'in_progress',
          acceptedBy: actorId,
        },
        { $set: { status: 'completed' } },
        { new: true }
      );
      if (!rideRequest) {
        const existing = await RideRequest.findById(rideRequestId).select('status acceptedBy').lean();
        if (
          existing &&
          existing.status === 'completed' &&
          String(existing.acceptedBy) === actorId
        ) {
          markEventProcessed(eventId);
          socket.emit('ride_completed_ack', { rideRequestId });
          if (typeof ack === 'function') ack({ ok: true, eventId, duplicate: true });
          return;
        }
        socket.emit('error', { message: 'Not authorized to end this ride' });
        if (typeof ack === 'function') ack({ ok: false, error: 'Not authorized' });
        return;
      }
      stampRideComplete(rideRequest);
      await rideRequest.save();

      const effectiveDriverId = String(rideRequest.acceptedBy || actorId);

      const riderUid =
        rideRequest.rider && rideRequest.rider._id != null
          ? rideRequest.rider._id
          : rideRequest.rider;
      const completionPayload = { rideRequestId, driverId: effectiveDriverId };

      // Emit FIRST so clients always get notified even if Ride bridge fails later.
      emitToUser(io, riderUid, 'ride_completed', completionPayload);
      if (effectiveDriverId) emitToUser(io, effectiveDriverId, 'ride_completed', completionPayload);
      // Don't echo ride_completed back to the initiating socket; drivers were getting duplicates.
      socket.emit('ride_completed_ack', { rideRequestId });

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
            driver: effectiveDriverId || null,
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
            duration: durationMinutesForRideDoc(rideRequest),
            paymentMethod: rideRequest.paymentMethod || 'cash',
            rating: {
              riderRating: null,
              driverRating: null,
              riderComment: null,
              driverComment: null,
            },
            startTime: rideRequest.startedAt || new Date(),
            endTime: rideRequest.completedAt || new Date(),
          });

          await ride.save();
        }
      } catch (bridgeErr) {
        console.error('end_ride Ride bridge error (non-fatal):', bridgeErr?.message || bridgeErr);
      }

      // Deduct commission (idempotent via DriverWalletTransaction.rideId)
      try {
        const driverUserId = effectiveDriverId;
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

      console.log(`✅ Ride ${rideRequestId} completed by driver ${effectiveDriverId}`);
      markEventProcessed(eventId);
      if (typeof ack === 'function') ack({ ok: true, eventId });
    } catch (err) {
      console.error('Error handling end_ride:', err);
      socket.emit('error', { message: 'Failed to end ride' });
      if (typeof ack === 'function') ack({ ok: false, error: 'Failed to end ride' });
    }
  });

  // Rider confirms safe arrival → complete ride (same logic as end_ride but triggered by rider)
  socket.on('rider_completed_ride', async (data, ack) => {
    try {
      const { rideRequestId, eventId } = data || {};
      if (isDuplicateEvent(eventId)) {
        if (typeof ack === 'function') ack({ ok: true, duplicate: true, eventId });
        return;
      }
      const actorId = socketUserId(socket);
      if (!actorId) {
        socket.emit('error', { message: 'Not authenticated' });
        if (typeof ack === 'function') ack({ ok: false, error: 'Not authenticated' });
        return;
      }
      const RideRequest = require('./models/RideRequest');
      let rideRequest = await RideRequest.findOneAndUpdate(
        { _id: rideRequestId, status: 'in_progress', rider: actorId },
        { $set: { status: 'completed' } },
        { new: true }
      );
      if (!rideRequest) {
        const existing = await RideRequest.findById(rideRequestId).select('status rider').lean();
        if (existing && existing.status === 'completed' && String(existing.rider) === actorId) {
          if (typeof ack === 'function') ack({ ok: true, duplicate: true, eventId });
          return;
        }
        socket.emit('error', { message: 'Not authorized' });
        if (typeof ack === 'function') ack({ ok: false, error: 'Not authorized' });
        return;
      }

      stampRideComplete(rideRequest);
      await rideRequest.save();
      const riderId = actorId;

      const effectiveDriverId = rideRequest.acceptedBy
        ? String(rideRequest.acceptedBy)
        : '';
      const riderUid = String(rideRequest.rider);
      const completionPayload = {
        rideRequestId,
        driverId: effectiveDriverId,
        completedByRider: true,
      };

      emitToUser(io, riderUid, 'ride_completed', completionPayload);
      if (effectiveDriverId) {
        emitToUser(io, effectiveDriverId, 'ride_completed', completionPayload);
        emitToUser(io, effectiveDriverId, 'rider_confirmed_arrival', {
          rideRequestId,
          message: 'The rider has marked the ride as completed.',
        });
      }

      // Bridge Ride document + commission (same as end_ride)
      const Ride = require('./models/Ride');
      try {
        const existingRide = await Ride.findById(rideRequest._id).select('_id');
        if (!existingRide) {
          const effectiveDestination = {
            address: rideRequest.destination?.address || rideRequest.destinationLocation?.address || '',
            latitude: rideRequest.destination?.latitude ?? rideRequest.destinationLocation?.latitude ?? 0,
            longitude: rideRequest.destination?.longitude ?? rideRequest.destinationLocation?.longitude ?? 0,
          };
          const ride = new Ride({
            _id: rideRequest._id,
            rider: rideRequest.rider,
            driver: effectiveDriverId || null,
            pickup: {
              address: rideRequest.pickupLocation?.address || '',
              location: { type: 'Point', coordinates: [rideRequest.pickupLocation?.longitude || 0, rideRequest.pickupLocation?.latitude || 0] },
            },
            destination: {
              address: effectiveDestination.address || '',
              location: { type: 'Point', coordinates: [effectiveDestination.longitude || 0, effectiveDestination.latitude || 0] },
            },
            status: 'completed',
            rideType: normalizeRideTypeKey(rideRequest.vehicleType || 'ride_mini'),
            price: { amount: rideRequest.requestedPrice || rideRequest.suggestedPrice || 0, currency: 'PKR', negotiated: true },
            distance: rideRequest.distance || 0,
            duration: durationMinutesForRideDoc(rideRequest),
            paymentMethod: rideRequest.paymentMethod || 'cash',
            rating: { riderRating: null, driverRating: null, riderComment: null, driverComment: null },
            startTime: rideRequest.startedAt || new Date(),
            endTime: rideRequest.completedAt || new Date(),
          });
          await ride.save();
        }
      } catch (bridgeErr) {
        console.error('rider_completed_ride Ride bridge error (non-fatal):', bridgeErr?.message || bridgeErr);
      }

      // Deduct commission
      try {
        if (effectiveDriverId) {
          const fare = rideRequest.requestedPrice || rideRequest.suggestedPrice || 0;
          const result = await deductDriverCommissionForRide({
            rideId: rideRequest._id,
            driverUserId: effectiveDriverId,
            vehicleType: rideRequest.vehicleType || 'ride_mini',
            fareAmount: fare,
          });
          if (result?.deducted) {
            await Ride.findByIdAndUpdate(rideRequest._id, {
              $set: { driverCommissionPct: result.pct || 0, driverCommissionAmount: result.amount || 0, commissionDeductedAt: new Date() },
            });
          }
        }
      } catch { /* ignore */ }

      console.log(`✅ Ride ${rideRequestId} completed by rider ${riderId}`);
      markEventProcessed(eventId);
      if (typeof ack === 'function') ack({ ok: true, eventId });
    } catch (err) {
      console.error('Error handling rider_completed_ride:', err);
      socket.emit('error', { message: 'Failed to complete ride' });
      if (typeof ack === 'function') ack({ ok: false, error: 'Failed to complete ride' });
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
  assertRuntimeSecretsOrExit();
  try {
    await connectMongo();
  } catch (err) {
    console.error('MongoDB connection error:', err?.message || err);
    process.exit(1);
  }

  const { startStaleRideExpirySweeper } = require('./lib/expireStaleRideRequests');
  startStaleRideExpirySweeper(io);

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
