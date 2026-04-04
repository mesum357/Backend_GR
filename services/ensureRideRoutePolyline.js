/**
 * One Directions API call per ride when a match is made; persist overview polyline
 * so clients can decode locally without re-calling Google on refresh (Rule 3).
 * Uses legacy Directions JSON (returns same encoded polyline as Routes overview).
 */
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
  const origin = `${oLat},${oLng}`;
  const dest = `${dLat},${dLng}`;
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(
    origin
  )}&destination=${encodeURIComponent(dest)}&key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  const data = await res.json();
  const poly = data?.routes?.[0]?.overview_polyline?.points;
  return typeof poly === 'string' && poly.length > 0 ? poly : null;
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
