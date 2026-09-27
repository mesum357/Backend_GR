/**
 * Actual trip timing for RideRequest (search expiresAt is separate).
 */

function stampRideStart(rideRequest) {
  if (!rideRequest) return;
  if (!rideRequest.startedAt) {
    rideRequest.startedAt = new Date();
  }
}

function stampRideComplete(rideRequest) {
  if (!rideRequest) return;
  const now = new Date();
  rideRequest.completedAt = now;
  const start = rideRequest.startedAt ? new Date(rideRequest.startedAt) : null;
  if (start && Number.isFinite(start.getTime())) {
    rideRequest.actualDurationSeconds = Math.max(0, Math.round((now.getTime() - start.getTime()) / 1000));
  } else {
    rideRequest.actualDurationSeconds = 0;
  }
}

function elapsedSecondsNow(rideRequest) {
  if (!rideRequest?.startedAt) return null;
  const start = new Date(rideRequest.startedAt);
  if (!Number.isFinite(start.getTime())) return null;
  const end = rideRequest.completedAt ? new Date(rideRequest.completedAt) : new Date();
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
}

/** Minutes stored on Ride documents (rating / history). */
function durationMinutesForRideDoc(rideRequest) {
  const secs = Number(rideRequest?.actualDurationSeconds);
  if (Number.isFinite(secs) && secs > 0) {
    return Math.max(1, Math.round(secs / 60));
  }
  const estimated = Number(rideRequest?.estimatedDuration);
  if (Number.isFinite(estimated) && estimated > 0) return estimated;
  return 0;
}

module.exports = {
  stampRideStart,
  stampRideComplete,
  elapsedSecondsNow,
  durationMinutesForRideDoc,
};
