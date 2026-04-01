const RideFareSettings = require('../models/RideFareSettings');

const RIDE_TYPE_KEYS = ['moto', 'ride_mini', 'ride_ac', 'premium'];

/** Fixed base + minimum per category (PKR). Only perKm is stored in DB. */
const STATIC = {
  moto: { baseFare: 50, minFare: 80, defaultPerKm: 15 },
  ride_mini: { baseFare: 100, minFare: 150, defaultPerKm: 25 },
  ride_ac: { baseFare: 150, minFare: 200, defaultPerKm: 35 },
  premium: { baseFare: 250, minFare: 350, defaultPerKm: 50 },
};

function normalizeRideTypeKey(vt) {
  if (vt == null || vt === '' || vt === 'any') return 'ride_mini';
  const s = String(vt)
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');
  if (s === 'motorcycle' || s === 'bike' || s === 'bicycle') return 'moto';
  if (s === 'ridemini') return 'ride_mini';
  if (s.includes('premium')) return 'premium';
  if (s.includes('ac') || s === 'ride_with_ac') return 'ride_ac';
  if (s.includes('moto') && !s.includes('mini')) return 'moto';
  if (s.includes('mini')) return 'ride_mini';
  if (RIDE_TYPE_KEYS.includes(s)) return s;
  return 'ride_mini';
}

function perKmFromStored(rideTypesDoc, key) {
  const raw = rideTypesDoc?.[key]?.perKm;
  const num = Number(raw);
  if (Number.isFinite(num) && num >= 1) return num;
  return STATIC[key].defaultPerKm;
}

async function loadStoredRideTypes() {
  const row = await RideFareSettings.findOne().lean();
  return row?.rideTypes || {};
}

async function getSuggestedPrice(distanceKm, vehicleType) {
  const key = normalizeRideTypeKey(vehicleType);
  const stored = await loadStoredRideTypes();
  const perKm = perKmFromStored(stored, key);
  const { baseFare, minFare } = STATIC[key];
  const d = Math.max(0, Number(distanceKm) || 0);
  return Math.round(Math.max(minFare, baseFare + d * perKm));
}

async function getPublicFareResponse() {
  const stored = await loadStoredRideTypes();
  const rideTypes = {};
  for (const key of RIDE_TYPE_KEYS) {
    const { baseFare, minFare, defaultPerKm } = STATIC[key];
    rideTypes[key] = {
      baseFare,
      minFare,
      perKm: perKmFromStored(stored, key),
      defaultPerKm,
    };
  }
  return { rideTypes };
}

module.exports = {
  RIDE_TYPE_KEYS,
  STATIC,
  normalizeRideTypeKey,
  getSuggestedPrice,
  getPublicFareResponse,
};
