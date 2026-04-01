const jwt = require('jsonwebtoken');

/**
 * Admin-only authentication for the Admin panel.
 * This does NOT depend on the User collection (unlike passport-jwt).
 */
const authenticateAdminJWT = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - Missing token' });
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) return res.status(401).json({ error: 'Unauthorized - Missing token' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret');
    if (!decoded || decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden - Admin access required' });
    }

    req.admin = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized - Invalid token' });
  }
};

module.exports = { authenticateAdminJWT };

