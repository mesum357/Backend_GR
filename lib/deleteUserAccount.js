const User = require('../models/User');
const Driver = require('../models/Driver');
const Ride = require('../models/Ride');
const RideRequest = require('../models/RideRequest');
const RideChatMessage = require('../models/RideChatMessage');
const DriverWalletTransaction = require('../models/DriverWalletTransaction');
const DriverPenaltyEvent = require('../models/DriverPenaltyEvent');
const SupportTicket = require('../models/SupportTicket');
const SupportMessage = require('../models/SupportMessage');
const EmailVerificationOtp = require('../models/EmailVerificationOtp');
const WhatsappOtp = require('../models/WhatsappOtp');

const ACTIVE_RIDE_REQUEST_STATUSES = ['searching', 'pending', 'accepted', 'in_progress'];
const ACTIVE_RIDE_STATUSES = ['pending', 'accepted', 'started'];

async function userHasActiveTrip(userId) {
  const uid = userId;
  const activeRequest = await RideRequest.findOne({
    $or: [{ rider: uid }, { acceptedBy: uid }],
    status: { $in: ACTIVE_RIDE_REQUEST_STATUSES },
  })
    .select('_id')
    .lean();
  if (activeRequest) return true;

  const activeRide = await Ride.findOne({
    $or: [{ rider: uid }, { driver: uid }],
    status: { $in: ACTIVE_RIDE_STATUSES },
  })
    .select('_id')
    .lean();
  return !!activeRide;
}

async function deleteRidesAndRequestsForUser(userId) {
  const uid = userId;
  const rideRequestFilter = {
    $or: [
      { rider: uid },
      { acceptedBy: uid },
      { 'availableDrivers.driver': uid },
      { 'fareOffers.driver': uid },
    ],
  };

  const rideRequestIds = await RideRequest.find(rideRequestFilter).distinct('_id');
  if (rideRequestIds.length > 0) {
    await RideChatMessage.deleteMany({
      $or: [{ rideRequest: { $in: rideRequestIds } }, { sender: uid }],
    });
  } else {
    await RideChatMessage.deleteMany({ sender: uid });
  }

  await Ride.deleteMany({ $or: [{ rider: uid }, { driver: uid }] });
  await RideRequest.deleteMany(rideRequestFilter);
}

async function deleteSupportDataForUser(userId) {
  const ticketIds = await SupportTicket.find({ user: userId }).distinct('_id');
  if (ticketIds.length > 0) {
    await SupportMessage.deleteMany({ ticket: { $in: ticketIds } });
  }
  await SupportTicket.deleteMany({ user: userId });
}

/**
 * Permanently delete a user account and associated data.
 * @param {import('../models/User')} user - Mongoose user document
 * @throws {{ code: string, message: string }} when deletion must be blocked
 */
async function deleteUserAccount(user) {
  const userId = user._id;

  if (await userHasActiveTrip(userId)) {
    const err = new Error('Finish or cancel your active trip before deleting your account.');
    err.code = 'ACTIVE_TRIP';
    throw err;
  }

  if (user.userType === 'driver') {
    const driver = await Driver.findOne({ user: userId });
    if (driver) {
      await DriverPenaltyEvent.deleteMany({ driver: driver._id });
      await Driver.findByIdAndDelete(driver._id);
    }
    await DriverWalletTransaction.deleteMany({ driverId: userId });
  } else {
    await DriverPenaltyEvent.deleteMany({ rider: userId });
  }

  await deleteSupportDataForUser(userId);

  const emailNorm = String(user.email || '').trim().toLowerCase();
  if (emailNorm) {
    await EmailVerificationOtp.deleteMany({ email: emailNorm });
  }
  const phone = String(user.phone || '').trim();
  if (phone) {
    await WhatsappOtp.deleteMany({ phone });
  }

  await deleteRidesAndRequestsForUser(userId);
  await User.findByIdAndDelete(userId);
}

module.exports = {
  deleteUserAccount,
  userHasActiveTrip,
  deleteRidesAndRequestsForUser,
};
