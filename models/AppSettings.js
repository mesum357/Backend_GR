const mongoose = require('mongoose');

const SINGLETON_ID = 'singleton';

const appSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: SINGLETON_ID },
    /** Minimum wallet balance (PKR) required for drivers to accept rides */
    driverMinimumWalletPkr: {
      type: Number,
      default: 500,
      min: 0,
      max: 10000000,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AppSettings', appSettingsSchema);
