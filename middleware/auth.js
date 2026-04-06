const passport = require('passport');
const jwt = require('jsonwebtoken');

// Middleware to authenticate JWT token
const authenticateJWT = (req, res, next) => {
  passport.authenticate('jwt', { session: false }, (err, user, info) => {
    if (err) {
      return res.status(500).json({ error: 'Authentication error' });
    }

    if (!user) {
      if (info && info.code === 'SESSION_SUPERSEDED') {
        return res.status(401).json({
          error: 'This account was signed in on another device. Please sign in again.',
          code: 'SESSION_SUPERSEDED',
        });
      }
      return res.status(401).json({ error: 'Unauthorized - Invalid token' });
    }

    req.user = user;
    next();
  })(req, res, next);
};

// Middleware to authenticate local strategy (email/password)
const authenticateLocal = (req, res, next) => {
  passport.authenticate('local', { session: false }, (err, user, info) => {
    if (err) {
      return res.status(500).json({ error: 'Authentication error' });
    }
    
    if (!user) {
      return res.status(401).json({ error: info.message || 'Invalid credentials' });
    }
    
    req.user = user;
    next();
  })(req, res, next);
};

// Middleware to check if user is authenticated (session-based)
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Not authenticated' });
};

// Middleware to check user type (rider or driver)
const requireUserType = (userType) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (req.user.userType !== userType) {
      return res.status(403).json({ error: `Access denied. ${userType} access required.` });
    }
    
    next();
  };
};

// Middleware to check if user is online (for drivers)
const requireOnline = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  if (req.user.userType === 'driver' && !req.user.isOnline) {
    return res.status(403).json({ error: 'Driver must be online to perform this action' });
  }
  
  next();
};

// Generate JWT token
const generateToken = (user) => {
  const sv = Number(user.authSessionVersion);
  const sessionVersion = Number.isFinite(sv) ? sv : 0;
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      userType: user.userType,
      sv: sessionVersion,
    },
    process.env.JWT_SECRET || 'your-jwt-secret',
    { expiresIn: '7d' }
  );
};

module.exports = {
  authenticateJWT,
  authenticateLocal,
  isAuthenticated,
  requireUserType,
  requireOnline,
  generateToken
};
