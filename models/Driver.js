const mongoose = require('mongoose');
const { normalizeRideTypeKey } = require('../utils/rideFarePricing');

const driverSchema = new mongoose.Schema({
  // Reference to User model
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },

  // Driver-specific information
  vehicleInfo: {
    make: { type: String, required: true },
    model: { type: String, required: true },
    year: { type: Number, required: true },
    color: { type: String, required: true },
    plateNumber: { type: String, required: true, unique: true },
    vehicleName: { type: String, default: null },
    rideType: { type: String, default: null },
    vehicleImage: { type: String, default: null },
    vehicleType: { 
      type: String, 
      enum: ['car', 'motorcycle', 'suv', 'van'],
      required: true 
    },
  },

  // Driver status and availability
  isOnline: { type: Boolean, default: false },
  isAvailable: { type: Boolean, default: false },
  
  // Penalty management (rider cancellations with “driver didn't arrive”)
  noArrivalStreakCount: { type: Number, default: 0 },
  noArrivalStreakStartedAt: { type: Date, default: null },
  noArrivalStreakLastAt: { type: Date, default: null },

  penaltyStatus: {
    type: String,
    enum: ['none', 'warning', 'penalized'],
    default: 'none',
  },
  accountDeactivatedUntil: { type: Date, default: null },
  currentLocation: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true,
    },
  },

  // Driver ratings and statistics
  rating: { type: Number, default: 0 },
  totalRides: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  completedRides: { type: Number, default: 0 },
  cancelledRides: { type: Number, default: 0 },

  // Driver documents and verification
  licenseNumber: { type: String, required: true, unique: true },
  licenseImage: { type: String, default: null },
  cnicFrontImage: { type: String, default: null },
  cnicBackImage: { type: String, default: null },
  licenseExpiry: { type: Date, required: true },
  insuranceNumber: { type: String, required: true },
  insuranceExpiry: { type: Date, required: true },
  isVerified: { type: Boolean, default: false },
  isApproved: { type: Boolean, default: false },
  approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  rejectionReason: { type: String, default: null },

  // Driver preferences
  preferredAreas: [{
    type: String,
    default: ['Gilgit City']
  }],
  maxDistance: { type: Number, default: 50 }, // in km
  minFare: { type: Number, default: 50 }, // minimum fare in PKR
  maxFare: { type: Number, default: 2000 }, // maximum fare in PKR

  // Driver wallet for managing payments
  wallet: {
    balance: {
      type: Number,
      default: 0,
      min: 0
    },
    currency: {
      type: String,
      default: 'PKR'
    },
    lastTransactionAt: {
      type: Date,
      default: null
    }
  },

  // Bank account information for payments
  bankInfo: {
    accountNumber: { type: String },
    bankName: { type: String },
    accountHolderName: { type: String },
  },

  // Driver schedule
  workingHours: {
    startTime: { type: String, default: '06:00' },
    endTime: { type: String, default: '22:00' },
    workingDays: {
      type: [String],
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      default: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    }
  },

  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now },

  /** H3 cell (res 9) for free hex matching — updated with GPS (Rule 5). */
  activeH3Cell: { type: String, default: null, index: true },
});

// Index for geospatial queries
driverSchema.index({ currentLocation: '2dsphere' });

// Index for online drivers
driverSchema.index({ isOnline: 1, isAvailable: 1 });

// Pre-save middleware to update timestamp
driverSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Method to update driver location
driverSchema.methods.updateLocation = async function(latitude, longitude) {
  // Validate coordinates
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new Error('Latitude and longitude must be numbers');
  }
  
  if (latitude < -90 || latitude > 90) {
    throw new Error('Latitude must be between -90 and 90');
  }
  
  if (longitude < -180 || longitude > 180) {
    throw new Error('Longitude must be between -180 and 180');
  }
  
  // Use updateOne to avoid Mongoose version conflicts during frequent polling.
  const coords = [parseFloat(longitude), parseFloat(latitude)];
  const lastActive = new Date();

  this.currentLocation.coordinates = coords;
  this.lastActive = lastActive;

  let activeH3Cell = null;
  try {
    const { latLngToCell } = require('h3-js');
    activeH3Cell = latLngToCell(latitude, longitude, 9);
  } catch (_) {
    // h3-js optional until npm install
  }

  const $set = {
    'currentLocation.coordinates': coords,
    lastActive,
  };
  if (activeH3Cell) {
    $set.activeH3Cell = activeH3Cell;
  }

  await this.updateOne({ $set });

  return this;
};

// Method to toggle online status
driverSchema.methods.toggleOnline = async function() {
  this.isOnline = !this.isOnline;
  this.isAvailable = this.isOnline;
  this.lastActive = new Date();
  return await this.save();
};

// Method to calculate average rating
driverSchema.methods.calculateRating = function(newRating) {
  const totalRating = (this.rating * this.totalRides) + newRating;
  this.totalRides += 1;
  this.rating = totalRating / this.totalRides;
  return this.save();
};

const driverOnlineFilter = {
  isOnline: true,
  isAvailable: true,
  isApproved: true,
  $or: [
    { accountDeactivatedUntil: null },
    { accountDeactivatedUntil: { $lte: new Date() } },
  ],
};

function normalizeDriverRideType(driverDoc) {
  const rawType = driverDoc?.vehicleInfo?.rideType || driverDoc?.vehicleInfo?.vehicleType || 'ride_mini';
  return normalizeRideTypeKey(rawType);
}

function isRideTypeCompatible(driverDoc, requestedVehicleType) {
  const requested = String(requestedVehicleType || '').trim().toLowerCase();
  if (!requested || requested === 'any') return true;
  return normalizeDriverRideType(driverDoc) === normalizeRideTypeKey(requestedVehicleType);
}

driverSchema.statics.findNearbyDriversByH3 = async function (
  latitude,
  longitude,
  ringK = 1
) {
  const { latLngToCell, gridDisk } = require('h3-js');
  const center = latLngToCell(latitude, longitude, 9);
  const cells = gridDisk(center, ringK);
  return await this.find({
    ...driverOnlineFilter,
    activeH3Cell: { $in: cells },
  })
    .populate('user', 'firstName lastName phone rating')
    .limit(20);
};

// Static method to find nearby available drivers
driverSchema.statics.findNearbyDrivers = async function (
  latitude,
  longitude,
  maxDistance = 5,
  requestedVehicleType = 'any'
) {
  if (process.env.USE_H3_DRIVER_MATCHING === 'true') {
    try {
      const h3Drivers = await this.findNearbyDriversByH3(latitude, longitude, 1);
      if (h3Drivers.length > 0) {
        return h3Drivers.filter((driver) => isRideTypeCompatible(driver, requestedVehicleType));
      }
    } catch (e) {
      console.warn('H3 driver matching failed, falling back to $near:', e?.message || e);
    }
  }
  const nearbyDrivers = await this.find({
    ...driverOnlineFilter,
    currentLocation: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude],
        },
        $maxDistance: maxDistance * 1000,
      },
    },
  })
    .populate('user', 'firstName lastName phone rating')
    .limit(20);
  return nearbyDrivers.filter((driver) => isRideTypeCompatible(driver, requestedVehicleType));
};

// Static method to create driver profile
driverSchema.statics.createDriverProfile = async function(userId, driverData) {
  const driver = new this({
    user: userId,
    ...driverData
  });
  return await driver.save();
};

module.exports = mongoose.model('Driver', driverSchema);
