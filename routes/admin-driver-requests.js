const express = require('express');
const Driver = require('../models/Driver');
const User = require('../models/User');
const { authenticateAdminJWT } = require('../middleware/admin-auth');

const router = express.Router();

// List driver requests
router.get('/driver-requests', authenticateAdminJWT, async (req, res) => {
  try {
    const status = String(req.query.status || 'pending'); // pending|approved|rejected|all
    const query = {};
    if (status !== 'all') {
      query.approvalStatus = status;
    }

    const drivers = await Driver.find(query)
      .populate('user', 'firstName lastName email phone profileImage')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ requests: drivers });
  } catch (err) {
    console.error('Error listing driver requests:', err);
    return res.status(500).json({ error: 'Failed to fetch driver requests' });
  }
});

router.patch('/driver-requests/:driverId/approve', authenticateAdminJWT, async (req, res) => {
  try {
    const { driverId } = req.params;
    const driver = await Driver.findById(driverId);
    if (!driver) return res.status(404).json({ error: 'Driver request not found' });

    driver.isApproved = true;
    driver.approvalStatus = 'approved';
    driver.rejectionReason = null;
    await driver.save();

    await User.findByIdAndUpdate(driver.user, { userType: 'driver' });

    return res.json({ message: 'Driver approved', driverId: driver._id });
  } catch (err) {
    console.error('Error approving driver:', err);
    return res.status(500).json({ error: 'Failed to approve driver' });
  }
});

router.patch('/driver-requests/:driverId/reject', authenticateAdminJWT, async (req, res) => {
  try {
    const { driverId } = req.params;
    const { reason } = req.body || {};
    const driver = await Driver.findById(driverId);
    if (!driver) return res.status(404).json({ error: 'Driver request not found' });

    driver.isApproved = false;
    driver.approvalStatus = 'rejected';
    driver.rejectionReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : null;
    await driver.save();

    return res.json({ message: 'Driver rejected', driverId: driver._id });
  } catch (err) {
    console.error('Error rejecting driver:', err);
    return res.status(500).json({ error: 'Failed to reject driver' });
  }
});

module.exports = router;

