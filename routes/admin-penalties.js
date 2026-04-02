const express = require('express');
const { authenticateAdminJWT } = require('../middleware/admin-auth');
const Driver = require('../models/Driver');
const DriverPenaltyEvent = require('../models/DriverPenaltyEvent');
const { getPenaltyRules, patchPenaltyRules } = require('../lib/penaltyRules');

const router = express.Router();

function buildDriverName(d) {
  const first = d?.user?.firstName || '';
  const last = d?.user?.lastName || '';
  return `${first} ${last}`.trim() || 'Driver';
}

router.get('/penalty-rules', authenticateAdminJWT, async (req, res) => {
  try {
    const rules = await getPenaltyRules();
    return res.json(rules);
  } catch {
    return res.status(500).json({ error: 'Failed to load penalty rules' });
  }
});

router.patch('/penalty-rules', authenticateAdminJWT, async (req, res) => {
  try {
    const rules = await patchPenaltyRules(req.body || {});
    return res.json(rules);
  } catch (e) {
    return res.status(e?.statusCode || 500).json({ error: e?.message || 'Failed to update penalty rules' });
  }
});

/**
 * Active penalty list for admin UI.
 * Returns both warnings and penalized drivers.
 */
router.get('/penalties/active', authenticateAdminJWT, async (req, res) => {
  try {
    const now = new Date();
    const drivers = await Driver.find({
      penaltyStatus: { $in: ['warning', 'penalized'] },
      accountDeactivatedUntil: { $gt: now },
    })
      .populate('user', 'firstName lastName phone')
      .lean();

    const penalties = drivers.map((d) => {
      const status = d.penaltyStatus === 'penalized' ? 'penalized' : 'warning';

      return {
        driverId: d.user?._id ? String(d.user._id) : String(d.user),
        driverDocId: String(d._id),
        driverName: buildDriverName(d),
        phone: d.user?.phone || '',
        noArrivalStreakCount: d.noArrivalStreakCount || 0,
        noArrivalStreakStartedAt: d.noArrivalStreakStartedAt || null,
        noArrivalStreakLastAt: d.noArrivalStreakLastAt || null,
        penaltyStatus: d.penaltyStatus, // warning|penalized
        accountDeactivatedUntil: d.accountDeactivatedUntil || null,
        status, // for UI
      };
    });

    const warningCount = penalties.filter((p) => p.status === 'warning').length;
    const penaltyCount = penalties.filter((p) => p.status === 'penalized').length;

    return res.json({
      penalties,
      stats: {
        activeWarnings: warningCount,
        activePenalties: penaltyCount,
        totalDriversWithWarnings: penalties.length,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load active penalties' });
  }
});

router.get('/penalties/:driverUserId/history', authenticateAdminJWT, async (req, res) => {
  try {
    const driverUserId = req.params.driverUserId;
    const driver = await Driver.findOne({ user: driverUserId }).lean();
    if (!driver) return res.json({ history: [] });

    const history = await DriverPenaltyEvent.find({ driver: driver._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return res.json({
      history: history.map((h) => ({
        id: h._id,
        createdAt: h.createdAt,
        reasonKey: h.reasonKey,
        streakCountAfter: h.streakCountAfter,
        appliedLevelAfter: h.appliedLevelAfter,
        rideRequest: h.rideRequest || null,
        rider: h.rider || null,
      })),
    });
  } catch {
    return res.status(500).json({ error: 'Failed to load penalty history' });
  }
});

module.exports = router;

