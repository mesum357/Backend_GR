const express = require('express');
const { authenticateAdminJWT } = require('../middleware/admin-auth');
const ServiceZone = require('../models/ServiceZone');

const router = express.Router();

// Admin list zones
router.get('/service-zones', authenticateAdminJWT, async (req, res) => {
  try {
    const zones = await ServiceZone.find({})
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ zones });
  } catch {
    return res.status(500).json({ error: 'Failed to load service zones' });
  }
});

// Admin create zone (default: service not available)
router.post('/service-zones', authenticateAdminJWT, async (req, res) => {
  try {
    const { name, city, latitude, longitude } = req.body || {};

    const zoneName = String(name || '').trim();
    const zoneCity = String(city || '').trim();
    const lat = Number(latitude);
    const lon = Number(longitude);

    if (!zoneName) return res.status(400).json({ error: 'Zone name is required' });
    if (!zoneCity) return res.status(400).json({ error: 'City is required' });
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return res.status(400).json({ error: 'Invalid latitude' });
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) return res.status(400).json({ error: 'Invalid longitude' });

    const zone = await ServiceZone.create({
      name: zoneName,
      city: zoneCity,
      latitude: lat,
      longitude: lon,
      isActive: false, // service not available by default for newly added zones
    });

    return res.status(201).json({ zone });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to create service zone' });
  }
});

module.exports = router;

