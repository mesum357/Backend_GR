const express = require('express');
const router = express.Router();
const Driver = require('../models/Driver');
const DriverWalletTransaction = require('../models/DriverWalletTransaction');
const { authenticateJWT } = require('../middleware/auth');

// Constants
const MINIMUM_BALANCE = 500; // PKR
const EASYPAISA_DETAILS = {
  accountNumber: '03001234567',
  accountHolder: 'Tourist Rides',
  instructions: 'Send money to the above EasyPaisa account and provide transaction ID'
};

// Get driver wallet balance and recent transactions
router.get('/balance', authenticateJWT, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) {
      return res.status(404).json({ message: 'Driver profile not found' });
    }

    // Get recent transactions
    const recentTransactions = await DriverWalletTransaction.find({ 
      driverId: req.user.id 
    })
    .sort({ createdAt: -1 })
    .limit(10)
    .select('transactionType amount status paymentMethod description createdAt updatedAt');

    res.json({
      balance: driver.wallet.balance,
      currency: driver.wallet.currency,
      minimumBalance: MINIMUM_BALANCE,
      canAcceptRides: driver.wallet.balance >= MINIMUM_BALANCE,
      lastTransactionAt: driver.wallet.lastTransactionAt,
      recentTransactions
    });
  } catch (error) {
    console.error('Error fetching wallet balance:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get EasyPaisa payment details for cash in
router.get('/payment-details', authenticateJWT, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) {
      return res.status(404).json({ message: 'Driver profile not found' });
    }

    res.json({
      paymentMethod: 'easypaisa',
      details: EASYPAISA_DETAILS,
      minimumAmount: 100,
      maximumAmount: 50000,
      instructions: [
        '1. Open your EasyPaisa app or visit EasyPaisa shop',
        '2. Send money to the account number provided',
        '3. Note down the transaction ID',
        '4. Enter the transaction ID and amount below',
        '5. Your request will be processed within 24 hours'
      ]
    });
  } catch (error) {
    console.error('Error fetching payment details:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Cash In request
router.post('/cash-in', authenticateJWT, async (req, res) => {
  try {
    const { amount, transactionId, paymentMethod = 'easypaisa' } = req.body;

    // Validation
    if (!amount || amount < 100) {
      return res.status(400).json({ message: 'Minimum cash in amount is 100 PKR' });
    }
    if (amount > 50000) {
      return res.status(400).json({ message: 'Maximum cash in amount is 50,000 PKR' });
    }
    if (!transactionId) {
      return res.status(400).json({ message: 'Transaction ID is required' });
    }

    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) {
      return res.status(404).json({ message: 'Driver profile not found' });
    }

    // Check if transaction ID already exists
    const existingTransaction = await DriverWalletTransaction.findOne({
      'paymentDetails.transactionId': transactionId,
      transactionType: 'cash_in'
    });
    if (existingTransaction) {
      return res.status(400).json({ message: 'Transaction ID already used' });
    }

    // Create transaction record
    const transaction = new DriverWalletTransaction({
      driverId: req.user.id,
      transactionType: 'cash_in',
      amount: amount,
      status: 'pending',
      paymentMethod: paymentMethod,
      paymentDetails: {
        transactionId: transactionId,
        accountNumber: EASYPAISA_DETAILS.accountNumber,
        accountHolder: EASYPAISA_DETAILS.accountHolder
      },
      description: `Cash in request via ${paymentMethod.toUpperCase()}`
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
    const remainingBalance = driver.wallet.balance - amount;
    if (remainingBalance < MINIMUM_BALANCE) {
      return res.status(400).json({ 
        message: `Cannot cash out. Minimum balance of ${MINIMUM_BALANCE} PKR must be maintained`,
        currentBalance: driver.wallet.balance,
        minimumBalance: MINIMUM_BALANCE
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

    const canAcceptRides = driver.wallet.balance >= MINIMUM_BALANCE;
    
    res.json({
      canAcceptRides,
      currentBalance: driver.wallet.balance,
      minimumBalance: MINIMUM_BALANCE,
      message: canAcceptRides 
        ? 'Driver can accept rides' 
        : `Minimum balance of ${MINIMUM_BALANCE} PKR required to accept rides`
    });
  } catch (error) {
    console.error('Error checking ride acceptance status:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
