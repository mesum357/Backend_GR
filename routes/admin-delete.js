const express = require('express');
const User = require('../models/User');
const Driver = require('../models/Driver');
const { deleteUserAccount } = require('../lib/deleteUserAccount');
const { authenticateAdminJWT } = require('../middleware/admin-auth');

const router = express.Router();

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || 'admin12345';
}

function verifyAdminPasswordBody(req, res, next) {
  const { password } = req.body || {};
  if (!password || String(password) !== String(getAdminPassword())) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  return next();
}

/** User must be a rider */
router.delete('/riders/:userId', authenticateAdminJWT, verifyAdminPasswordBody, async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user || user.userType !== 'rider') {
      return res.status(404).json({ error: 'Rider not found' });
    }

    await deleteUserAccount(user);

    return res.json({ message: 'Rider deleted' });
  } catch (err) {
    console.error('Admin delete rider error:', err);
    if (err.code === 'ACTIVE_TRIP') {
      return res.status(409).json({ error: err.message, code: err.code });
    }
    return res.status(500).json({ error: 'Failed to delete rider' });
  }
});

/** :driverId is the Driver document id */
router.delete('/drivers/:driverId', authenticateAdminJWT, verifyAdminPasswordBody, async (req, res) => {
  try {
    const { driverId } = req.params;
    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    const user = await User.findById(driver.user);
    if (!user || user.userType !== 'driver') {
      return res.status(400).json({ error: 'Linked user is not a driver account' });
    }

    await deleteUserAccount(user);

    return res.json({ message: 'Driver deleted' });
  } catch (err) {
    console.error('Admin delete driver error:', err);
    if (err.code === 'ACTIVE_TRIP') {
      return res.status(409).json({ error: err.message, code: err.code });
    }
    return res.status(500).json({ error: 'Failed to delete driver' });
  }
});

module.exports = router;
