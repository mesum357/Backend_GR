const AppSettings = require('../models/AppSettings');

const DEFAULTS = {
  forceEnabled: false,
  currentVersion: '',
  minVersion: '',
  message: 'A new version is available. Please update to continue.',
  playStoreUrl: '',
  appStoreUrl: '',
};

function s(v) {
  if (v == null) return null;
  const str = String(v).trim();
  return str;
}

function b(v) {
  if (v == null) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false') return false;
  }
  return null;
}

async function getAppUpdateSettings() {
  const doc = await AppSettings.findById('singleton').lean();
  const legacyCurrent =
    s(doc?.appCurrentVersion) ||
    s(doc?.riderAppCurrentVersion) ||
    s(doc?.driverAppCurrentVersion) ||
    DEFAULTS.currentVersion;
  const legacyMin =
    s(doc?.appMinVersion) ||
    s(doc?.riderAppMinVersion) ||
    s(doc?.driverAppMinVersion) ||
    DEFAULTS.minVersion;
  return {
    forceEnabled: b(doc?.appUpdateForceEnabled) ?? DEFAULTS.forceEnabled,
    currentVersion: legacyCurrent,
    minVersion: legacyMin,
    message: s(doc?.appUpdateMessage) ?? DEFAULTS.message,
    playStoreUrl: s(doc?.appUpdatePlayStoreUrl) ?? DEFAULTS.playStoreUrl,
    appStoreUrl: s(doc?.appUpdateAppStoreUrl) ?? DEFAULTS.appStoreUrl,
  };
}

async function patchAppUpdateSettings(body) {
  const patch = {};

  const forceEnabled = b(body?.forceEnabled ?? body?.appUpdateForceEnabled);
  if (forceEnabled !== null) patch.appUpdateForceEnabled = forceEnabled;

  const currentVersion = s(body?.currentVersion ?? body?.appCurrentVersion);
  if (currentVersion !== null) patch.appCurrentVersion = currentVersion;

  const minVersion = s(body?.minVersion ?? body?.appMinVersion);
  if (minVersion !== null) patch.appMinVersion = minVersion;

  const message = s(body?.message ?? body?.appUpdateMessage);
  if (message !== null) patch.appUpdateMessage = message;

  const playStoreUrl = s(body?.playStoreUrl ?? body?.appUpdatePlayStoreUrl);
  if (playStoreUrl !== null) patch.appUpdatePlayStoreUrl = playStoreUrl;

  const appStoreUrl = s(body?.appStoreUrl ?? body?.appUpdateAppStoreUrl);
  if (appStoreUrl !== null) patch.appUpdateAppStoreUrl = appStoreUrl;

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

  return getAppUpdateSettings();
}

module.exports = { getAppUpdateSettings, patchAppUpdateSettings };

