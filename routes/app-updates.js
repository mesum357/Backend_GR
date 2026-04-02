const express = require('express');
const { getAppUpdateSettings } = require('../lib/appUpdateSettings');

const router = express.Router();

/**
 * Public endpoint for mobile apps to check if update is required.
 * Query:
 * - version: current app version (optional)
 */
router.get('/app-updates', async (req, res) => {
  try {
    const version = req.query.version != null ? String(req.query.version).trim() : '';

    const settings = await getAppUpdateSettings();

    // NOTE: we do not implement semantic version compare here; treat inequality as “unknown”.
    // Mobile clients should compare semver properly. This endpoint provides min/current + force flag.
    return res.json({
      currentVersion: settings.currentVersion,
      minVersion: settings.minVersion,
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

