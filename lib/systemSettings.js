const AppSettings = require('../models/AppSettings');

const DEFAULT_MAX_RIDE_RADIUS_KM = 5;
const DEFAULT_DRIVER_TIMEOUT_SECONDS = 72;

function toSafeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sanitizeKm(v) {
  const n = toSafeNumber(v);
  if (n == null) return null;
  return n > 0 ? n : null;
}

function sanitizeSeconds(v) {
  const n = toSafeNumber(v);
  if (n == null) return null;
  return n > 0 ? n : null;
}

async function getSystemSettings() {
  const doc = await AppSettings.findById('singleton').lean();
  const maxRideRadiusKm = sanitizeKm(doc?.maxRideRadiusKm) ?? DEFAULT_MAX_RIDE_RADIUS_KM;
  const driverTimeoutSeconds = sanitizeSeconds(doc?.driverTimeoutSeconds) ?? DEFAULT_DRIVER_TIMEOUT_SECONDS;

  return {
    maxRideRadiusKm,
    driverTimeoutSeconds,
  };
}

async function patchSystemSettings(body) {
  const patch = {};
  if (body && body.maxRideRadiusKm !== undefined) {
    const v = sanitizeKm(body.maxRideRadiusKm);
    if (v == null) {
      const err = new Error('maxRideRadiusKm must be a positive number');
      err.statusCode = 400;
      throw err;
    }
    // Keep precision reasonable.
    patch.maxRideRadiusKm = Math.round(v * 1000) / 1000;
  }

  if (body && body.driverTimeoutSeconds !== undefined) {
    const v = sanitizeSeconds(body.driverTimeoutSeconds);
    if (v == null) {
      const err = new Error('driverTimeoutSeconds must be a positive number');
      err.statusCode = 400;
      throw err;
    }
    patch.driverTimeoutSeconds = Math.round(v * 1000) / 1000;
  }

  if (Object.keys(patch).length === 0) {
    const err = new Error('No valid fields to update');
    err.statusCode = 400;
    throw err;
  }

  await AppSettings.findOneAndUpdate(
    { _id: 'singleton' },
    { $set: patch },
    { upsert: true, new: true }
  );

  return getSystemSettings();
}

module.exports = {
  DEFAULT_MAX_RIDE_RADIUS_KM,
  DEFAULT_DRIVER_TIMEOUT_SECONDS,
  getSystemSettings,
  patchSystemSettings,
};

