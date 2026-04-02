const Driver = require('../models/Driver');
const DriverPenaltyEvent = require('../models/DriverPenaltyEvent');
const { getPenaltyRules } = require('./penaltyRules');

function daysToMs(d) {
  return Number(d) * 24 * 60 * 60 * 1000;
}

function isDriverDidNotArriveReasonKey(key) {
  if (!key || typeof key !== 'string') return false;
  const k = key.trim().toLowerCase();
  return (
    k === 'driver_did_not_arrive' ||
    k === 'driver_doesnt_arrive' ||
    k === 'driver_didnt_arrive' ||
    k === 'driver_not_arrived' ||
    k.includes('did_not_arrive') ||
    (k.includes('doesnt') && k.includes('arrive'))
  );
}

/**
 * Updates driver's consecutive streak + warning/penalty status.
 *
 * If reasonKey is not “driver did not arrive”, we reset the streak count only
 * (does not resolve an active warning/penalty deactivation).
 */
async function registerRiderCancellationForPenalty({
  riderId,
  rideRequestId,
  driverUserId,
  reasonKey,
}) {
  if (!driverUserId) return null;

  const driver = await Driver.findOne({ user: driverUserId });
  if (!driver) return null;

  const rules = await getPenaltyRules();
  const now = new Date();

  const driverDidNotArrive = isDriverDidNotArriveReasonKey(reasonKey);

  // Reset streak if different reason.
  if (!driverDidNotArrive) {
    // If reason is missing or not “driver didn't arrive”, it breaks the consecutive streak.
    driver.noArrivalStreakCount = 0;
    driver.noArrivalStreakStartedAt = null;
    driver.noArrivalStreakLastAt = null;
    await driver.save();

    // Still record event for history.
    await DriverPenaltyEvent.create({
      driver: driver._id,
      rider: riderId || null,
      rideRequest: rideRequestId || null,
      reasonKey: reasonKey ? String(reasonKey) : 'no_reason',
      streakCountAfter: 0,
      appliedLevelAfter: driver.penaltyStatus || 'none',
    });

    return driver;
  }

  if (!driver.noArrivalStreakStartedAt) {
    driver.noArrivalStreakStartedAt = now;
  }

  driver.noArrivalStreakCount = (driver.noArrivalStreakCount || 0) + 1;
  driver.noArrivalStreakLastAt = now;

  // Apply penalty / warning based on configured consecutive strike thresholds.
  const currentStreakCount = driver.noArrivalStreakCount;
  const warningTimes = Math.max(1, Number(rules.warningTimes || 1));
  const penaltyTimes = Math.max(1, Number(rules.penaltyTimes || 1));

  const eligibleWarning = currentStreakCount >= warningTimes;
  const eligiblePenalty = currentStreakCount >= penaltyTimes;

  let appliedLevelAfter = driver.penaltyStatus || 'none';

  if (eligiblePenalty) {
    driver.penaltyStatus = 'penalized';
    driver.accountDeactivatedUntil = new Date(now.getTime() + daysToMs(rules.penaltyDeactivationDays));
    appliedLevelAfter = 'penalized';
  } else if (eligibleWarning) {
    // Don't overwrite an active penalty.
    if (driver.penaltyStatus !== 'penalized') {
      driver.penaltyStatus = 'warning';
      driver.accountDeactivatedUntil = new Date(now.getTime() + daysToMs(rules.warningDeactivationDays));
      appliedLevelAfter = 'warning';
    }
  }

  await driver.save();

  await DriverPenaltyEvent.create({
    driver: driver._id,
    rider: riderId || null,
    rideRequest: rideRequestId || null,
    reasonKey: reasonKey ? String(reasonKey) : 'driver_did_not_arrive',
    streakCountAfter: driver.noArrivalStreakCount,
    appliedLevelAfter,
  });

  return driver;
}

module.exports = {
  registerRiderCancellationForPenalty,
};

