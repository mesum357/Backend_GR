const ServiceZone = require('../models/ServiceZone');
const { getSystemSettings } = require('./systemSettings');

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Haversine distance (km)
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * @returns {Promise<null | { zone: any, distanceKm: number }>}
 */
async function getServiceUnavailableZoneAt(lat, lon) {
  const latitude = toNumber(lat);
  const longitude = toNumber(lon);
  if (latitude == null || longitude == null) return null;

  const systemSettings = await getSystemSettings();
  const maxRideRadiusKm = Number(systemSettings.maxRideRadiusKm) || 5;

  // Only zones where service is not available.
  const zones = await ServiceZone.find({ isActive: false }).lean();
  if (!Array.isArray(zones) || zones.length === 0) return null;

  for (const z of zones) {
    const zLat = toNumber(z?.latitude);
    const zLon = toNumber(z?.longitude);
    if (zLat == null || zLon == null) continue;

    // Prefer zone radius; fallback to configured max ride radius.
    const rKm = Number(z?.radiusKm);
    const effectiveRadiusKm = Number.isFinite(rKm) && rKm > 0 ? rKm : maxRideRadiusKm;

    const dKm = distanceKm(latitude, longitude, zLat, zLon);
    if (dKm <= effectiveRadiusKm) {
      return { zone: z, distanceKm: dKm };
    }
  }

  return null;
}

module.exports = {
  getServiceUnavailableZoneAt,
};

