const express = require('express');
const jwt = require('jsonwebtoken');
const { authenticateAdminJWT } = require('../middleware/admin-auth');

const router = express.Router();

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@gbrides.pk';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin12345';

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (String(email).toLowerCase().trim() !== String(adminEmail).toLowerCase().trim() || String(password) !== String(adminPassword)) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const token = jwt.sign(
      { role: 'admin', email: String(adminEmail).toLowerCase().trim() },
      process.env.JWT_SECRET || 'your-jwt-secret',
      { expiresIn: '7d' }
    );

    return res.json({
      message: 'Admin login successful',
      token,
      admin: { email: String(adminEmail).toLowerCase().trim(), role: 'admin' },
    });
  } catch (err) {
    console.error('Admin login error:', err);
    return res.status(500).json({ error: 'Admin authentication error' });
  }
});

router.get('/auth/me', authenticateAdminJWT, async (req, res) => {
  return res.json({ admin: req.admin });
});

module.exports = router;

