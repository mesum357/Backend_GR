const mongoose = require('mongoose');

const easypaisaJazzSchema = new mongoose.Schema(
  {
    accountNumber: { type: String, default: '' },
    accountHolder: { type: String, default: '' },
    instructions: { type: String, default: '' },
  },
  { _id: false }
);

const bankSchema = new mongoose.Schema(
  {
    bankName: { type: String, default: '' },
    accountTitle: { type: String, default: '' },
    accountNumber: { type: String, default: '' },
    iban: { type: String, default: '' },
    branch: { type: String, default: '' },
    instructions: { type: String, default: '' },
  },
  { _id: false }
);

const appSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'singleton' },
    /** Max radius (km) used when finding nearby drivers for a ride. */
    maxRideRadiusKm: {
      type: Number,
      default: 5,
      min: 0.1,
      max: 500,
    },
    /** How long (seconds) a ride request remains valid while searching for drivers. */
    driverTimeoutSeconds: {
      type: Number,
      default: 72,
      min: 10,
      max: 3600,
    },
    /** Penalty rules: warning strike threshold (times) for “driver didn't arrive” consecutive cancels. */
    driverPenaltyWarningTimes: {
      type: Number,
      default: 3,
      min: 1,
      max: 1000,
    },
    /** Penalty rules: penalty strike threshold (times) for “driver didn't arrive” consecutive cancels. */
    driverPenaltyTimes: {
      type: Number,
      default: 5,
      min: 1,
      max: 1000,
    },
    /** Penalty rules: account deactivation duration (days) when warning threshold is reached. */
    driverPenaltyWarningDeactivationDays: {
      type: Number,
      default: 7,
      min: 0.1,
      max: 3650,
    },
    /** Penalty rules: account deactivation duration (days) when penalty threshold is reached. */
    driverPenaltyDeactivationDays: {
      type: Number,
      default: 7,
      min: 0.1,
      max: 3650,
    },
    /** Minimum wallet balance (PKR) required for drivers to accept rides */
    driverMinimumWalletPkr: {
      type: Number,
      default: 500,
      min: 0,
      max: 10000000,
    },
    /** Shown to drivers when topping up wallet */
    paymentMethods: {
      easypaisa: { type: easypaisaJazzSchema, default: () => ({}) },
      jazzcash: { type: easypaisaJazzSchema, default: () => ({}) },
      bank: { type: bankSchema, default: () => ({}) },
    },

    /** App update management (single platform config; rider/driver separated). */
    appUpdateForceEnabled: { type: Boolean, default: false },
    riderAppCurrentVersion: { type: String, default: '' },
    riderAppMinVersion: { type: String, default: '' },
    driverAppCurrentVersion: { type: String, default: '' },
    driverAppMinVersion: { type: String, default: '' },
    appUpdateMessage: { type: String, default: 'A new version is available. Please update to continue.' },
    appUpdatePlayStoreUrl: { type: String, default: '' },
    appUpdateAppStoreUrl: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AppSettings', appSettingsSchema);
