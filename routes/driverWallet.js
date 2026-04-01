const express = require('express');
const router = express.Router();
const Driver = require('../models/Driver');
const DriverWalletTransaction = require('../models/DriverWalletTransaction');
const { authenticateJWT } = require('../middleware/auth');
const {
  getDriverMinimumWalletPkr,
  getDriverPaymentDetailsPayload,
  getCashInSnapshotForMethod,
} = require('../lib/walletSettings');

// Get driver wallet balance and recent transactions
router.get('/balance', authenticateJWT, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) {
      return res.status(404).json({ message: 'Driver profile not found' });
    }

    // Get recent transactions (omit large proof images in list)
    const recentTransactions = await DriverWalletTransaction.find({
      driverId: req.user.id
    })
      .sort({ createdAt: -1 })
      .limit(15)
      .select('transactionType amount status paymentMethod paymentDetails description createdAt updatedAt')
      .lean();

    const sanitized = recentTransactions.map((t) => {
      const row = { ...t };
      if (row.paymentDetails && row.paymentDetails.proofImage) {
        row.paymentDetails = {
          ...row.paymentDetails,
          proofImage: undefined,
          hasProofImage: true,
        };
      }
      return row;
    });

    const minimumBalance = await getDriverMinimumWalletPkr();
    res.json({
      balance: driver.wallet.balance,
      currency: driver.wallet.currency,
      minimumBalance,
      canAcceptRides: driver.wallet.balance >= minimumBalance,
      lastTransactionAt: driver.wallet.lastTransactionAt,
      recentTransactions: sanitized,
    });
  } catch (error) {
    console.error('Error fetching wallet balance:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Payment details for top-up (EasyPaisa, JazzCash, bank — from admin settings)
router.get('/payment-details', authenticateJWT, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) {
      return res.status(404).json({ message: 'Driver profile not found' });
    }

    const payload = await getDriverPaymentDetailsPayload();
    res.json(payload);
  } catch (error) {
    console.error('Error fetching payment details:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Cash In request (top-up)
router.post('/cash-in', authenticateJWT, async (req, res) => {
  try {
    const { amount, transactionId, paymentMethod = 'easypaisa', senderName, screenshot } = req.body;
    const method = String(paymentMethod || 'easypaisa').trim();
    if (!['easypaisa', 'jazzcash', 'bank_transfer'].includes(method)) {
      return res.status(400).json({ message: 'Invalid payment method' });
    }

    // Validation
    if (!amount || amount < 100) {
      return res.status(400).json({ message: 'Minimum cash in amount is 100 PKR' });
    }
    if (amount > 50000) {
      return res.status(400).json({ message: 'Maximum cash in amount is 50,000 PKR' });
    }
    if (!transactionId || !String(transactionId).trim()) {
      return res.status(400).json({ message: 'Transaction ID is required' });
    }
    if (!senderName || !String(senderName).trim()) {
      return res.status(400).json({ message: 'Sender name is required' });
    }
    if (!screenshot || !String(screenshot).trim()) {
      return res.status(400).json({ message: 'Payment screenshot is required' });
    }

    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) {
      return res.status(404).json({ message: 'Driver profile not found' });
    }

    // Check if transaction ID already exists
    const existingTransaction = await DriverWalletTransaction.findOne({
      'paymentDetails.transactionId': String(transactionId).trim(),
      transactionType: 'cash_in'
    });
    if (existingTransaction) {
      return res.status(400).json({ message: 'Transaction ID already used' });
    }

    const snap = await getCashInSnapshotForMethod(method);
    const paymentDetails = {
      transactionId: String(transactionId).trim(),
      accountNumber: snap.accountNumber,
      accountHolder: snap.accountHolder,
      senderName: String(senderName).trim(),
      proofImage: String(screenshot).trim(),
    };
    if (snap.reference) {
      paymentDetails.reference = snap.reference;
    }

    // Create transaction record
    const transaction = new DriverWalletTransaction({
      driverId: req.user.id,
      transactionType: 'cash_in',
      amount: Number(amount),
      status: 'pending',
      paymentMethod: method,
      paymentDetails,
      description: `Top-up request via ${method.replace('_', ' ').toUpperCase()}`
    });

    await transaction.save();

    res.status(201).json({
      message: 'Cash in request submitted successfully',
      transaction: {
        id: transaction._id,
        amount: transaction.amount,
        status: transaction.status,
        transactionId: transactionId,
        createdAt: transaction.createdAt
      }
    });
  } catch (error) {
    console.error('Error processing cash in:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Cash Out request
router.post('/cash-out', authenticateJWT, async (req, res) => {
  try {
    const { amount, paymentMethod = 'easypaisa', accountNumber, accountHolder } = req.body;

    // Validation
    if (!amount || amount < 100) {
      return res.status(400).json({ message: 'Minimum cash out amount is 100 PKR' });
    }
    if (!accountNumber || !accountHolder) {
      return res.status(400).json({ message: 'Account number and holder name are required' });
    }

    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) {
      return res.status(404).json({ message: 'Driver profile not found' });
    }

    // Check if driver has sufficient balance
    if (driver.wallet.balance < amount) {
      return res.status(400).json({ 
        message: 'Insufficient balance',
        currentBalance: driver.wallet.balance 
      });
    }

    // Check if remaining balance will be above minimum (for active drivers)
    const minimumBalance = await getDriverMinimumWalletPkr();
    const remainingBalance = driver.wallet.balance - amount;
    if (remainingBalance < minimumBalance) {
      return res.status(400).json({ 
        message: `Cannot cash out. Minimum balance of ${minimumBalance} PKR must be maintained`,
        currentBalance: driver.wallet.balance,
        minimumBalance
      });
    }

    // Create transaction record
    const transaction = new DriverWalletTransaction({
      driverId: req.user.id,
      transactionType: 'cash_out',
      amount: amount,
      status: 'pending',
      paymentMethod: paymentMethod,
      paymentDetails: {
        accountNumber: accountNumber,
        accountHolder: accountHolder
      },
      description: `Cash out request to ${paymentMethod.toUpperCase()}`
    });

    await transaction.save();

    res.status(201).json({
      message: 'Cash out request submitted successfully',
      transaction: {
        id: transaction._id,
        amount: transaction.amount,
        status: transaction.status,
        paymentMethod: paymentMethod,
        createdAt: transaction.createdAt
      }
    });
  } catch (error) {
    console.error('Error processing cash out:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get transaction history
router.get('/transactions', authenticateJWT, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, type } = req.query;
    
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) {
      return res.status(404).json({ message: 'Driver profile not found' });
    }

    // Build query
    const query = { driverId: req.user.id };
    if (status) query.status = status;
    if (type) query.transactionType = type;

    const skip = (page - 1) * limit;
    
    const transactions = await DriverWalletTransaction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('transactionType amount status paymentMethod paymentDetails description createdAt updatedAt processedAt');

    const total = await DriverWalletTransaction.countDocuments(query);

    res.json({
      transactions,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Check if driver can accept rides (minimum balance check)
router.get('/can-accept-rides', authenticateJWT, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) {
      return res.status(404).json({ message: 'Driver profile not found' });
    }

    const minimumBalance = await getDriverMinimumWalletPkr();
    const canAcceptRides = driver.wallet.balance >= minimumBalance;
    
    res.json({
      canAcceptRides,
      currentBalance: driver.wallet.balance,
      minimumBalance,
      message: canAcceptRides 
        ? 'Driver can accept rides' 
        : `Minimum balance of ${minimumBalance} PKR required to accept rides`
    });
  } catch (error) {
    console.error('Error checking ride acceptance status:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
