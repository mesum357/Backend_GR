const express = require('express');
const { authenticateAdminJWT } = require('../middleware/admin-auth');
const { getSystemSettings, patchSystemSettings } = require('../lib/systemSettings');

const router = express.Router();

// Public endpoint for mobile apps to read current system settings.
router.get('/system-settings', async (req, res) => {
  try {
    const settings = await getSystemSettings();
    return res.json(settings);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load system settings' });
  }
});

// Admin-only endpoint to update settings.
router.patch('/system-settings', authenticateAdminJWT, async (req, res) => {
  try {
    const settings = await patchSystemSettings(req.body || {});
    return res.json(settings);
  } catch (e) {
    return res.status(e?.statusCode || 500).json({
      error: e?.message || 'Failed to update system settings',
    });
  }
});

module.exports = router;

