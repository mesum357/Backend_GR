const express = require('express');
const DriverWalletTransaction = require('../models/DriverWalletTransaction');
const Driver = require('../models/Driver');
const { authenticateAdminJWT } = require('../middleware/admin-auth');

const router = express.Router();

/** List cash-in (top-up) requests for admin */
router.get('/wallet/top-up-requests', authenticateAdminJWT, async (req, res) => {
  try {
    const status = String(req.query.status || 'all');
    const query = { transactionType: 'cash_in' };
    if (status === 'pending') query.status = 'pending';
    else if (status === 'approved') query.status = 'approved';
    else if (status === 'rejected') query.status = 'rejected';
    else if (status === 'completed') query.status = 'completed';

    const transactions = await DriverWalletTransaction.find(query)
      .populate('driverId', 'firstName lastName email phone')
      .sort({ createdAt: -1 })
      .limit(300)
      .lean();

    return res.json({ transactions });
  } catch (err) {
    console.error('List top-up requests error:', err);
    return res.status(500).json({ error: 'Failed to list top-up requests' });
  }
});

/** Approve: credit driver wallet and mark transaction completed */
router.patch('/wallet/transactions/:transactionId/approve', authenticateAdminJWT, async (req, res) => {
  try {
    const { transactionId } = req.params;
    const tx = await DriverWalletTransaction.findById(transactionId);
    if (!tx || tx.transactionType !== 'cash_in') {
      return res.status(404).json({ error: 'Top-up request not found' });
    }
    if (tx.status !== 'pending') {
      return res.status(400).json({ error: 'Request is not pending' });
    }

    const driver = await Driver.findOne({ user: tx.driverId });
    if (!driver) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    driver.wallet.balance = Number(driver.wallet.balance || 0) + Number(tx.amount);
    driver.wallet.lastTransactionAt = new Date();
    await driver.save();

    tx.status = 'completed';
    tx.processedAt = new Date();
    await tx.save();

    return res.json({ message: 'Top-up approved and wallet credited', transactionId: tx._id });
  } catch (err) {
    console.error('Approve top-up error:', err);
    return res.status(500).json({ error: 'Failed to approve top-up' });
  }
});

router.patch('/wallet/transactions/:transactionId/reject', authenticateAdminJWT, async (req, res) => {
  try {
    const { transactionId } = req.params;
    const tx = await DriverWalletTransaction.findById(transactionId);
    if (!tx || tx.transactionType !== 'cash_in') {
      return res.status(404).json({ error: 'Top-up request not found' });
    }
    if (tx.status !== 'pending') {
      return res.status(400).json({ error: 'Request is not pending' });
    }

    tx.status = 'rejected';
    tx.processedAt = new Date();
    await tx.save();

    return res.json({ message: 'Top-up rejected', transactionId: tx._id });
  } catch (err) {
    console.error('Reject top-up error:', err);
    return res.status(500).json({ error: 'Failed to reject top-up' });
  }
});

module.exports = router;
