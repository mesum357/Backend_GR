const mongoose = require('mongoose');

const driverWalletTransactionSchema = new mongoose.Schema({
  driverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  transactionType: {
    type: String,
    enum: ['cash_in', 'cash_out', 'ride_deduction', 'refund'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'completed'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['easypaisa', 'jazzcash', 'bank_transfer', 'cash'],
    required: function() {
      return this.transactionType === 'cash_in' || this.transactionType === 'cash_out';
    }
  },
  paymentDetails: {
    accountNumber: String,
    accountHolder: String,
    transactionId: String,
    reference: String
  },
  description: {
    type: String,
    maxlength: 500
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Admin who approved/rejected
    default: null
  },
  processedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field before saving
driverWalletTransactionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index for efficient queries
driverWalletTransactionSchema.index({ driverId: 1, createdAt: -1 });
driverWalletTransactionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('DriverWalletTransaction', driverWalletTransactionSchema);
