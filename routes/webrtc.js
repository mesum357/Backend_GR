const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/auth');
const { buildIceServers } = require('../lib/buildIceServers');

/**
 * GET /api/webrtc/ice-servers
 * Returns STUN/TURN config for in-app ride calls.
 * TURN credentials stay on the server (never baked into the APK).
 */
router.get('/ice-servers', authenticateJWT, async (req, res) => {
  try {
    const result = await buildIceServers();
    if (!result.hasTurn && process.env.NODE_ENV === 'production') {
      console.warn(
        '[webrtc] No TURN configured — cross-network calls will fail. Set TWILIO_*, METERED_*, or TURN_* env vars.'
      );
    }
    return res.json({
      iceServers: result.iceServers,
      ttlSeconds: result.ttlSeconds,
      provider: result.provider,
      hasTurn: result.hasTurn,
    });
  } catch (error) {
    console.error('Error building ICE servers:', error);
    return res.status(500).json({ error: 'Failed to load ICE servers' });
  }
});

module.exports = router;
