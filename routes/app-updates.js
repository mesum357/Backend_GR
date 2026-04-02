const express = require('express');
const { getAppUpdateSettings } = require('../lib/appUpdateSettings');

const router = express.Router();

/**
 * Public endpoint for mobile apps to check if update is required.
 * Query:
 * - app: rider|driver
 * - version: current app version (optional)
 */
router.get('/app-updates', async (req, res) => {
  try {
    const app = String(req.query.app || '').trim().toLowerCase();
    const version = req.query.version != null ? String(req.query.version).trim() : '';

    if (!['rider', 'driver'].includes(app)) {
      return res.status(400).json({ error: 'app must be rider or driver' });
    }

    const settings = await getAppUpdateSettings();

    const current = app === 'rider' ? settings.riderCurrent : settings.driverCurrent;
    const min = app === 'rider' ? settings.riderMin : settings.driverMin;

    // NOTE: we do not implement semantic version compare here; treat inequality as “unknown”.
    // Mobile clients should compare semver properly. This endpoint provides min/current + force flag.
    return res.json({
      app,
      currentVersion: current,
      minVersion: min,
      forceEnabled: !!settings.forceEnabled,
      message: settings.message,
      playStoreUrl: settings.playStoreUrl,
      appStoreUrl: settings.appStoreUrl,
      clientVersion: version,
    });
  } catch {
    return res.status(500).json({ error: 'Failed to load app updates' });
  }
});

module.exports = router;

