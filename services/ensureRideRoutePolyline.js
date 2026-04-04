/**
 * One Directions API call per ride when a match is made; persist overview polyline
 * so clients can decode locally without re-calling Google on refresh (Rule 3).
 * Uses legacy Directions JSON (returns same encoded polyline as Routes overview).
 *
 * Route cache: rounds coordinates to ~100m precision and caches for 1 hour.
 * Rides between the same two neighborhoods share one Google API call.
 */

const ROUTE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const ROUTE_CACHE_MAX_SIZE = 500;
const routeCache = new Map(); // cacheKey -> { poly, fetchedAt }

function roundCoord(n, decimals = 3) {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

function routeCacheKey(oLat, oLng, dLat, dLng) {
  return `${roundCoord(oLat)},${roundCoord(oLng)}|${roundCoord(dLat)},${roundCoord(dLng)}`;
}

async function fetchOverviewPolyline(pickup, destination) {
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return null;
  const oLat = pickup?.latitude;
  const oLng = pickup?.longitude;
  const dLat = destination?.latitude;
  const dLng = destination?.longitude;
  if (
    [oLat, oLng, dLat, dLng].some(
      (x) => typeof x !== 'number' || !Number.isFinite(x)
    )
  ) {
    return null;
  }

  // Check cache first
  const cKey = routeCacheKey(oLat, oLng, dLat, dLng);
  const cached = routeCache.get(cKey);
  if (cached && Date.now() - cached.fetchedAt < ROUTE_CACHE_TTL_MS) {
    return cached.poly;
  }

  const origin = `${oLat},${oLng}`;
  const dest = `${dLat},${dLng}`;
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(
    origin
  )}&destination=${encodeURIComponent(dest)}&key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  const data = await res.json();
  const poly = data?.routes?.[0]?.overview_polyline?.points;
  const result = typeof poly === 'string' && poly.length > 0 ? poly : null;

  // Store in cache (evict oldest if full)
  if (result) {
    if (routeCache.size >= ROUTE_CACHE_MAX_SIZE) {
      const firstKey = routeCache.keys().next().value;
      routeCache.delete(firstKey);
    }
    routeCache.set(cKey, { poly: result, fetchedAt: Date.now() });
  }

  return result;
}

/**
 * @param {import('mongoose').Document} rideRequestDoc - RideRequest mongoose doc
 */
async function ensureRideRoutePolylineSaved(rideRequestDoc) {
  if (!rideRequestDoc || rideRequestDoc.routeOverviewPolyline) return;
  try {
    const poly = await fetchOverviewPolyline(
      rideRequestDoc.pickupLocation,
      rideRequestDoc.destination
    );
    if (!poly) return;
    rideRequestDoc.routeOverviewPolyline = poly;
    rideRequestDoc.markModified?.('routeOverviewPolyline');
    await rideRequestDoc.save();
  } catch (e) {
    console.warn('ensureRideRoutePolylineSaved:', e?.message || e);
  }
}

module.exports = { ensureRideRoutePolylineSaved, fetchOverviewPolyline };
