const AppSettings = require('../models/AppSettings');

const DEFAULT_RULES = {
  warningTimes: 3,
  penaltyTimes: 5,
  warningDeactivationDays: 7,
  penaltyDeactivationDays: 7,
};

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

async function getPenaltyRules() {
  try {
    const doc = await AppSettings.findById('singleton').lean();
    return {
      warningTimes: n(doc?.driverPenaltyWarningTimes) ?? DEFAULT_RULES.warningTimes,
      penaltyTimes: n(doc?.driverPenaltyTimes) ?? DEFAULT_RULES.penaltyTimes,
      warningDeactivationDays:
        n(doc?.driverPenaltyWarningDeactivationDays) ?? DEFAULT_RULES.warningDeactivationDays,
      penaltyDeactivationDays:
        n(doc?.driverPenaltyDeactivationDays) ?? DEFAULT_RULES.penaltyDeactivationDays,
    };
  } catch (e) {
    return DEFAULT_RULES;
  }
}

async function patchPenaltyRules(body) {
  const patch = {};

  const warningTimes = n(body?.warningTimes ?? body?.driverPenaltyWarningTimes);
  const penaltyTimes = n(body?.penaltyTimes ?? body?.driverPenaltyTimes);
  const warningDeactivationDays = n(
    body?.warningDeactivationDays ?? body?.driverPenaltyWarningDeactivationDays
  );
  const penaltyDeactivationDays = n(
    body?.penaltyDeactivationDays ?? body?.driverPenaltyDeactivationDays
  );

  // Validate optional fields only if provided
  if (warningTimes !== null) {
    if (warningTimes < 1 || warningTimes > 1000) {
      const err = new Error('warningTimes must be between 1 and 1000');
      err.statusCode = 400;
      throw err;
    }
    patch.driverPenaltyWarningTimes = Math.round(warningTimes);
  }

  if (penaltyTimes !== null) {
    if (penaltyTimes < 1 || penaltyTimes > 1000) {
      const err = new Error('penaltyTimes must be between 1 and 1000');
      err.statusCode = 400;
      throw err;
    }
    patch.driverPenaltyTimes = Math.round(penaltyTimes);
  }

  if (warningDeactivationDays !== null) {
    if (warningDeactivationDays < 0.1 || warningDeactivationDays > 3650) {
      const err = new Error('warningDeactivationDays must be between 0.1 and 3650');
      err.statusCode = 400;
      throw err;
    }
    patch.driverPenaltyWarningDeactivationDays = Math.round(warningDeactivationDays * 1000) / 1000;
  }

  if (penaltyDeactivationDays !== null) {
    if (penaltyDeactivationDays < 0.1 || penaltyDeactivationDays > 3650) {
      const err = new Error('penaltyDeactivationDays must be between 0.1 and 3650');
      err.statusCode = 400;
      throw err;
    }
    patch.driverPenaltyDeactivationDays = Math.round(penaltyDeactivationDays * 1000) / 1000;
  }

  if (Object.keys(patch).length === 0) {
    const err = new Error('No valid penalty rule fields to update');
    err.statusCode = 400;
    throw err;
  }

  await AppSettings.findOneAndUpdate(
    { _id: 'singleton' },
    { $set: patch },
    { upsert: true, new: true }
  );

  return getPenaltyRules();
}

module.exports = {
  DEFAULT_RULES,
  getPenaltyRules,
  patchPenaltyRules,
};

