const express = require('express');
const RideFareSettings = require('../models/RideFareSettings');
const { authenticateAdminJWT } = require('../middleware/admin-auth');
const { RIDE_TYPE_KEYS, STATIC, getPublicFareResponse } = require('../utils/rideFarePricing');

const router = express.Router();

router.get('/ride-fare-settings', authenticateAdminJWT, async (req, res) => {
  try {
    const doc = await RideFareSettings.getSingleton();
    const merged = await getPublicFareResponse();
    return res.json({
      rideTypes: merged.rideTypes,
      updatedAt: doc.updatedAt,
    });
  } catch (err) {
    console.error('admin ride-fare-settings GET error:', err);
    return res.status(500).json({ error: 'Failed to load ride fare settings' });
  }
});

router.patch('/ride-fare-settings', authenticateAdminJWT, async (req, res) => {
  try {
    const body = req.body?.rideTypes || req.body || {};
    const incomingCommission = req.body?.driverCommissionPct || req.body?.commission || null;
    const doc = await RideFareSettings.getSingleton();
    const prev = doc.rideTypes ? JSON.parse(JSON.stringify(doc.rideTypes)) : {};
    const next = { ...prev };

    for (const key of RIDE_TYPE_KEYS) {
      const incoming = body[key];
      if (incoming == null) continue;
      const perKm = Number(incoming.perKm ?? incoming);
      if (!Number.isFinite(perKm) || perKm < 1 || perKm > 500) {
        return res.status(400).json({ error: `Invalid perKm for ${key} (1–500)` });
      }
      next[key] = { ...(next[key] || {}), perKm };
    }

    doc.rideTypes = next;

    // Driver commission updates (optional)
    if (incomingCommission && typeof incomingCommission === 'object') {
      const prevC = doc.driverCommissionPct ? JSON.parse(JSON.stringify(doc.driverCommissionPct)) : {};
      const nextC = { ...prevC };
      for (const key of RIDE_TYPE_KEYS) {
        if (incomingCommission[key] == null) continue;
        const pct = Number(incomingCommission[key]);
        if (!Number.isFinite(pct) || pct < 0 || pct > 50) {
          return res.status(400).json({ error: `Invalid driverCommissionPct for ${key} (0–50)` });
        }
        nextC[key] = Math.round(pct * 100) / 100;
      }
      doc.driverCommissionPct = nextC;
    }

    await doc.save();
    const merged = await getPublicFareResponse();
    return res.json({
      rideTypes: merged.rideTypes,
      updatedAt: doc.updatedAt,
    });
  } catch (err) {
    console.error('admin ride-fare-settings PATCH error:', err);
    return res.status(500).json({ error: 'Failed to update ride fare settings' });
  }
});

module.exports = router;
