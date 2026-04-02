const Driver = require('../models/Driver');
const DriverWalletTransaction = require('../models/DriverWalletTransaction');
const { normalizeRideTypeKey, getDriverCommissionPctForRideType } = require('../utils/rideFarePricing');

async function deductDriverCommissionForRide({ rideId, driverUserId, vehicleType, fareAmount }) {
  const driverId = driverUserId ? String(driverUserId) : '';
  if (!rideId || !driverId) return { deducted: false, reason: 'missing_ride_or_driver' };

  const existing = await DriverWalletTransaction.findOne({
    driverId,
    rideId,
    transactionType: 'ride_deduction',
  }).select('_id');
  if (existing) return { deducted: false, reason: 'already_deducted' };

  const pct = await getDriverCommissionPctForRideType(vehicleType);
  const amount = Math.max(0, Math.round((Number(fareAmount || 0) * pct) / 100));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { deducted: false, reason: 'zero_commission', pct, amount: 0 };
  }

  const driver = await Driver.findOne({ user: driverId });
  if (!driver) return { deducted: false, reason: 'driver_not_found' };

  // Deduct from wallet (allow balance to reach 0; accept is blocked separately).
  driver.wallet.balance = Math.max(0, Number(driver.wallet.balance || 0) - amount);
  driver.wallet.lastTransactionAt = new Date();
  await driver.save();

  await DriverWalletTransaction.create({
    driverId,
    rideId,
    transactionType: 'ride_deduction',
    amount,
    status: 'completed',
    description: `Driver commission (${pct}%) for ride ${String(rideId)}`,
    processedAt: new Date(),
  });

  return { deducted: true, pct, amount, rideType: normalizeRideTypeKey(vehicleType) };
}

module.exports = { deductDriverCommissionForRide };

