const AppSettings = require('../models/AppSettings');

const DEFAULT_RULES = {
  warningPeriodDays: 30,
  penaltyPeriodDays: 30,
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
      warningPeriodDays:
        n(doc?.driverPenaltyWarningPeriodDays) ?? DEFAULT_RULES.warningPeriodDays,
      penaltyPeriodDays: n(doc?.driverPenaltyPeriodDays) ?? DEFAULT_RULES.penaltyPeriodDays,
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

  const warningPeriodDays = n(body?.warningPeriodDays ?? body?.driverPenaltyWarningPeriodDays);
  const penaltyPeriodDays = n(body?.penaltyPeriodDays ?? body?.driverPenaltyPeriodDays);
  const warningDeactivationDays = n(
    body?.warningDeactivationDays ?? body?.driverPenaltyWarningDeactivationDays
  );
  const penaltyDeactivationDays = n(
    body?.penaltyDeactivationDays ?? body?.driverPenaltyDeactivationDays
  );

  // Validate optional fields only if provided
  if (warningPeriodDays !== null) {
    if (warningPeriodDays < 1 || warningPeriodDays > 3650) {
      const err = new Error('warningPeriodDays must be between 1 and 3650');
      err.statusCode = 400;
      throw err;
    }
    patch.driverPenaltyWarningPeriodDays = Math.round(warningPeriodDays * 1000) / 1000;
  }

  if (penaltyPeriodDays !== null) {
    if (penaltyPeriodDays < 1 || penaltyPeriodDays > 3650) {
      const err = new Error('penaltyPeriodDays must be between 1 and 3650');
      err.statusCode = 400;
      throw err;
    }
    patch.driverPenaltyPeriodDays = Math.round(penaltyPeriodDays * 1000) / 1000;
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

