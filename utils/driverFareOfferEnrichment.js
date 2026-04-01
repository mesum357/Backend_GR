const mongoose = require('mongoose');
const User = require('../models/User');
const Driver = require('../models/Driver');

/**
 * Build display fields for rider fare-offer UIs from the driver's User id.
 * @param {import('mongoose').Types.ObjectId|string} driverUserId
 */
async function buildDriverFareOfferEnrichment(driverUserId) {
  const uid = driverUserId != null ? String(driverUserId) : '';
  if (!uid || !mongoose.Types.ObjectId.isValid(uid)) {
    return {
      driverName: 'Driver',
      driverRating: 0,
      vehicleInfo: 'Vehicle',
      vehicleName: '',
      driverPhoto: '',
    };
  }

  const oid = new mongoose.Types.ObjectId(uid);
  const driverDoc = await Driver.findOne({ user: oid })
    .populate({ path: 'user', select: 'firstName lastName profileImage rating' })
    .select('rating vehicleInfo')
    .lean();

  const u = driverDoc?.user && typeof driverDoc.user === 'object' ? driverDoc.user : null;
  if (!u) {
    const userLean = await User.findById(oid).select('firstName lastName profileImage rating').lean();
    if (!userLean) {
      return {
        driverName: 'Driver',
        driverRating: 0,
        vehicleInfo: 'Vehicle',
        vehicleName: '',
        driverPhoto: '',
      };
    }
    return {
      driverName: `${userLean.firstName || ''} ${userLean.lastName || ''}`.trim() || 'Driver',
      driverRating: Number(userLean.rating) || 0,
      vehicleInfo: 'Vehicle',
      vehicleName: '',
      driverPhoto: userLean.profileImage || '',
    };
  }

  const v = driverDoc.vehicleInfo || {};
  const vehicleName = (v.vehicleName && String(v.vehicleName).trim()) || '';
  const makeModel = [v.make, v.model].filter(Boolean).join(' ').trim();
  const shortLabel = vehicleName || makeModel || '';

  const parts = [];
  if (vehicleName) parts.push(vehicleName);
  if (makeModel && makeModel !== vehicleName) parts.push(makeModel);
  if (v.color) parts.push(v.color);
  if (v.plateNumber) parts.push(v.plateNumber);
  if (!parts.length && v.vehicleType) parts.push(String(v.vehicleType));
  const vehicleInfo = parts.length ? parts.join(' · ') : 'Vehicle';

  return {
    driverName: `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Driver',
    driverRating: Number(driverDoc.rating) || Number(u.rating) || 0,
    vehicleInfo,
    vehicleName: shortLabel,
    driverPhoto: u.profileImage || '',
  };
}

module.exports = { buildDriverFareOfferEnrichment };
