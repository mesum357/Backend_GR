const RideRequest = require('../models/RideRequest');

/** Searching/pending requests past expiresAt. */
const SEARCH_STATUSES = ['searching', 'pending'];
/** Matched but never finished — leftover "live" rows in admin. */
const ACCEPTED_ABANDONED_MS = 6 * 60 * 60 * 1000; // 6 hours
const IN_PROGRESS_ABANDONED_MS = 24 * 60 * 60 * 1000; // 24 hours
const SWEEP_INTERVAL_MS = 60 * 1000;
const BATCH_LIMIT = 250;

function emitExpired(io, ride, newStatus) {
  if (!io || !ride) return;
  const rid = String(ride._id);
  const payload = { rideRequestId: rid };
  const payloadDetailed = {
    rideRequestId: rid,
    message: newStatus === 'expired' ? 'Ride request has expired' : 'Ride request was closed as abandoned',
    newStatus,
    timestamp: new Date().toISOString(),
  };
  const userIds = new Set();
  if (ride.rider) userIds.add(String(ride.rider));
  if (ride.acceptedBy) userIds.add(String(ride.acceptedBy));
  if (Array.isArray(ride.availableDrivers)) {
    ride.availableDrivers.forEach((e) => {
      if (e?.driver) userIds.add(String(e.driver));
    });
  }
  if (Array.isArray(ride.fareOffers)) {
    ride.fareOffers.forEach((o) => {
      if (o?.driver) userIds.add(String(o.driver));
    });
  }
  for (const uid of userIds) {
    io.to(`user:${uid}`).emit('ride_request_cancelled', payloadDetailed);
    io.to(`user:${uid}`).emit('ride_cancelled', payload);
  }
}

/**
 * Persist a single searching/pending request as expired (used by REST/socket guards).
 */
async function markRideRequestExpiredIfNeeded(rideRequest) {
  if (!rideRequest) return false;
  if (!SEARCH_STATUSES.includes(rideRequest.status)) return false;
  if (!rideRequest.expiresAt || new Date(rideRequest.expiresAt).getTime() > Date.now()) return false;
  rideRequest.status = 'expired';
  await rideRequest.save();
  return true;
}

async function expireStaleRideRequests({ io } = {}) {
  const now = new Date();
  const notifySelect = 'rider acceptedBy availableDrivers fareOffers status';

  const searchDocs = await RideRequest.find({
    status: { $in: SEARCH_STATUSES },
    expiresAt: { $lte: now },
  })
    .select(notifySelect)
    .limit(BATCH_LIMIT)
    .lean();

  const acceptedCutoff = new Date(now.getTime() - ACCEPTED_ABANDONED_MS);
  const acceptedDocs = await RideRequest.find({
    status: 'accepted',
    emergencyStatus: { $ne: 'active' },
    $or: [{ updatedAt: { $lte: acceptedCutoff } }, { updatedAt: { $exists: false }, createdAt: { $lte: acceptedCutoff } }],
  })
    .select(notifySelect)
    .limit(BATCH_LIMIT)
    .lean();

  const inProgressCutoff = new Date(now.getTime() - IN_PROGRESS_ABANDONED_MS);
  const inProgressDocs = await RideRequest.find({
    status: 'in_progress',
    emergencyStatus: { $ne: 'active' },
    $or: [{ updatedAt: { $lte: inProgressCutoff } }, { updatedAt: { $exists: false }, createdAt: { $lte: inProgressCutoff } }],
  })
    .select(notifySelect)
    .limit(BATCH_LIMIT)
    .lean();

  const expireIds = searchDocs.map((r) => r._id);
  const abandonIds = [...acceptedDocs, ...inProgressDocs].map((r) => r._id);

  if (expireIds.length) {
    await RideRequest.updateMany(
      { _id: { $in: expireIds }, status: { $in: SEARCH_STATUSES } },
      { $set: { status: 'expired', updatedAt: now } }
    );
    searchDocs.forEach((r) => emitExpired(io, r, 'expired'));
  }

  if (abandonIds.length) {
    await RideRequest.updateMany(
      { _id: { $in: abandonIds }, status: { $in: ['accepted', 'in_progress'] } },
      { $set: { status: 'cancelled', cancelledAt: now, updatedAt: now } }
    );
    [...acceptedDocs, ...inProgressDocs].forEach((r) => emitExpired(io, r, 'cancelled'));
  }

  const expiredCount = expireIds.length;
  const abandonedCount = abandonIds.length;
  if (expiredCount || abandonedCount) {
    console.log(
      `🧹 Stale rides: expired ${expiredCount} searching/pending, cancelled ${abandonedCount} abandoned accepted/in_progress`
    );
  }

  return { expiredCount, abandonedCount };
}

function startStaleRideExpirySweeper(io) {
  const run = () =>
    expireStaleRideRequests({ io }).catch((err) => {
      console.error('stale ride expiry sweeper failed:', err?.message || err);
    });
  run();
  setInterval(run, SWEEP_INTERVAL_MS).unref();
}

module.exports = {
  expireStaleRideRequests,
  markRideRequestExpiredIfNeeded,
  startStaleRideExpirySweeper,
};
