const AppSettings = require('../models/AppSettings');

const DEFAULT_DRIVER_MINIMUM_WALLET_PKR = 500;

/**
 * @returns {Promise<number>}
 */
async function getDriverMinimumWalletPkr() {
  try {
    const doc = await AppSettings.findById('singleton').lean();
    if (!doc) return DEFAULT_DRIVER_MINIMUM_WALLET_PKR;
    const v = Number(doc.driverMinimumWalletPkr);
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_DRIVER_MINIMUM_WALLET_PKR;
  } catch (e) {
    console.error('getDriverMinimumWalletPkr:', e);
    return DEFAULT_DRIVER_MINIMUM_WALLET_PKR;
  }
}

/**
 * @param {unknown} raw
 * @returns {Promise<number>}
 */
async function setDriverMinimumWalletPkr(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 10000000) {
    const err = new Error('driverMinimumWalletPkr must be a number between 0 and 10,000,000');
    err.statusCode = 400;
    throw err;
  }
  await AppSettings.findOneAndUpdate(
    { _id: 'singleton' },
    { $set: { driverMinimumWalletPkr: Math.round(n * 1000) / 1000 } },
    { upsert: true, new: true }
  );
  return n;
}

module.exports = {
  getDriverMinimumWalletPkr,
  setDriverMinimumWalletPkr,
  DEFAULT_DRIVER_MINIMUM_WALLET_PKR,
};
