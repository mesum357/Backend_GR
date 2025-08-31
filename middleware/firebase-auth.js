const { helpers } = require('../config/firebase');

// Firebase authentication middleware
const firebaseAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'No Firebase ID token provided' 
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    if (!idToken) {
      return res.status(401).json({ 
        error: 'Invalid authorization header format' 
      });
    }

    // Verify the Firebase ID token
    const decodedToken = await helpers.verifyIdToken(idToken);
    
    // Add user info to request object
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      firebaseUser: decodedToken
    };

    next();
  } catch (error) {
    console.error('Firebase auth error:', error.message);
    return res.status(401).json({ 
      error: 'Invalid Firebase ID token' 
    });
  }
};

// Optional Firebase authentication middleware
const optionalFirebaseAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No token provided, continue without authentication
      req.user = null;
      return next();
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    if (!idToken) {
      req.user = null;
      return next();
    }

    // Verify the Firebase ID token
    const decodedToken = await helpers.verifyIdToken(idToken);
    
    // Add user info to request object
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      firebaseUser: decodedToken
    };

    next();
  } catch (error) {
    console.error('Optional Firebase auth error:', error.message);
    // Continue without authentication on error
    req.user = null;
    next();
  }
};

// Check if user has specific role (for role-based access control)
const requireRole = (role) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // You can implement role checking logic here
    // For example, check against a database or custom claims
    if (req.user.firebaseUser && req.user.firebaseUser.role === role) {
      next();
    } else {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
  };
};

// Check if user is a driver
const requireDriver = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Check if user has driver role or is registered as a driver
  // This can be customized based on your user model
  if (req.user.firebaseUser && req.user.firebaseUser.role === 'driver') {
    next();
  } else {
    return res.status(403).json({ error: 'Driver access required' });
  }
};

// Check if user is a rider
const requireRider = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Check if user has rider role or is registered as a rider
  if (req.user.firebaseUser && req.user.firebaseUser.role === 'rider') {
    next();
  } else {
    return res.status(403).json({ error: 'Rider access required' });
  }
};

module.exports = {
  firebaseAuth,
  optionalFirebaseAuth,
  requireRole,
  requireDriver,
  requireRider
};
