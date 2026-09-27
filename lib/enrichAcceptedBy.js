const Driver = require('../models/Driver');

/**
 * Turn an acceptedBy user (populated or ObjectId) into a lean client-facing object
 * including vehicle details from the Driver profile.
 */
async function enrichAcceptedBy(acceptedBy) {
  if (!acceptedBy) return null;

  const userId =
    acceptedBy._id != null
      ? String(acceptedBy._id)
      : acceptedBy.id != null
        ? String(acceptedBy.id)
        : String(acceptedBy);

  const base =
    typeof acceptedBy === 'object' && (acceptedBy.firstName != null || acceptedBy.phone != null)
      ? {
          _id: userId,
          id: userId,
          firstName: acceptedBy.firstName || '',
          lastName: acceptedBy.lastName || '',
          phone: acceptedBy.phone || '',
          rating: typeof acceptedBy.rating === 'number' ? acceptedBy.rating : 0,
          profileImage: acceptedBy.profileImage || null,
        }
      : { _id: userId, id: userId };

  try {
    const driver = await Driver.findOne({ user: userId })
      .select('vehicleInfo currentLocation')
      .lean();
    if (driver?.vehicleInfo) {
      const v = driver.vehicleInfo;
      base.vehicle = {
        make: v.make || '',
        model: v.model || '',
        color: v.color || '',
        plateNumber: v.plateNumber || '---',
        vehicleName: v.vehicleName || null,
        vehicleType: v.vehicleType || null,
        rideType: v.rideType || null,
      };
      if (driver.currentLocation?.coordinates?.length >= 2) {
        base.currentLocation = {
          longitude: driver.currentLocation.coordinates[0],
          latitude: driver.currentLocation.coordinates[1],
        };
      }
    }
  } catch {
    // Non-fatal: return user fields without vehicle
  }

  return base;
}

/**
 * Serialize a RideRequest for status / active-ride restore payloads.
 */
function serializeRideRequestCore(rideRequest, acceptedByEnriched) {
  return {
    id: rideRequest._id,
    _id: rideRequest._id,
    status: rideRequest.status,
    pickupLocation: rideRequest.pickupLocation,
    destination: rideRequest.destination,
    distance: rideRequest.distance,
    estimatedDuration: rideRequest.estimatedDuration,
    startedAt: rideRequest.startedAt || null,
    completedAt: rideRequest.completedAt || null,
    actualDurationSeconds: rideRequest.actualDurationSeconds,
    requestedPrice: rideRequest.requestedPrice,
    suggestedPrice: rideRequest.suggestedPrice,
    expiresAt: rideRequest.expiresAt,
    createdAt: rideRequest.createdAt,
    acceptedBy: acceptedByEnriched,
    riderArrivedAt: rideRequest.riderArrivedAt,
    routeOverviewPolyline: rideRequest.routeOverviewPolyline || '',
    emergencyStatus: rideRequest.emergencyStatus,
    emergencyTriggeredAt: rideRequest.emergencyTriggeredAt,
    emergencyResolvedAt: rideRequest.emergencyResolvedAt,
  };
}

module.exports = {
  enrichAcceptedBy,
  serializeRideRequestCore,
};
