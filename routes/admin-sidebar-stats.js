const express = require('express');
const Driver = require('../models/Driver');
const DriverWalletTransaction = require('../models/DriverWalletTransaction');
const RideRequest = require('../models/RideRequest');
const SupportTicket = require('../models/SupportTicket');
const { authenticateAdminJWT } = require('../middleware/admin-auth');

const router = express.Router();

/**
 * Aggregated counts for the admin sidebar (single lightweight request).
 */
router.get('/sidebar-counts', authenticateAdminJWT, async (req, res) => {
  try {
    const [pendingDriverRequests, pendingPaymentRequests, activeEmergencyRides, openSupportTickets] =
      await Promise.all([
        Driver.countDocuments({ approvalStatus: 'pending' }),
        DriverWalletTransaction.countDocuments({
          transactionType: 'cash_in',
          status: 'pending',
        }),
        RideRequest.countDocuments({
          isUrgent: true,
          status: { $in: ['searching', 'pending', 'accepted', 'in_progress'] },
        }),
        SupportTicket.countDocuments({ status: { $in: ['open', 'answered'] } }),
      ]);

    return res.json({
      pendingDriverRequests,
      pendingPaymentRequests,
      activeEmergencyRides,
      openSupportTickets,
    });
  } catch (err) {
    console.error('Sidebar counts error:', err);
    return res.status(500).json({ error: 'Failed to load sidebar counts' });
  }
});

module.exports = router;
