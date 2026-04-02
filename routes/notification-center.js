const express = require('express');
const { authenticateJWT } = require('../middleware/auth');
const AdminNotification = require('../models/AdminNotification');
const PopupAd = require('../models/PopupAd');

const router = express.Router();

function nowInRange(now, startAt, endAt) {
  if (startAt && new Date(startAt) > now) return false;
  if (endAt && new Date(endAt) < now) return false;
  return true;
}

router.get('/notifications', authenticateJWT, async (req, res) => {
  try {
    const userType = req.user?.userType; // rider|driver
    const audience = userType === 'driver' ? 'drivers' : 'riders';

    const notifications = await AdminNotification.find({
      status: 'sent',
      audience: { $in: ['all', audience] },
    })
      .sort({ sentAt: -1, createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({ notifications });
  } catch {
    return res.status(500).json({ error: 'Failed to load notifications' });
  }
});

router.get('/popup-ads/active', authenticateJWT, async (req, res) => {
  try {
    const userType = req.user?.userType;
    const audience = userType === 'driver' ? 'drivers' : 'riders';
    const now = new Date();

    const ads = await PopupAd.find({
      active: true,
      audience: { $in: ['all', audience] },
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const filtered = ads.filter((a) => nowInRange(now, a.startAt, a.endAt));

    return res.json({ ads: filtered });
  } catch {
    return res.status(500).json({ error: 'Failed to load popup ads' });
  }
});

module.exports = router;

