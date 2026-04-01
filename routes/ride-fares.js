const express = require('express');
const { getPublicFareResponse } = require('../utils/rideFarePricing');

const router = express.Router();

/** Public fare matrix for rider app (no auth). */
router.get('/', async (req, res) => {
  try {
    const payload = await getPublicFareResponse();
    return res.json(payload);
  } catch (err) {
    console.error('ride-fares GET error:', err);
    return res.status(500).json({ error: 'Failed to load fare settings' });
  }
});

module.exports = router;
