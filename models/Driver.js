const mongoose = require('mongoose');

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
    vehicleType: { 
      type: String, 
      enum: ['car', 'motorcycle', 'suv', 'van'],
      required: true 
    },
  },

  // Driver status and availability
  isOnline: { type: Boolean, default: false },
  isAvailable: { type: Boolean, default: false },
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
  licenseExpiry: { type: Date, required: true },
  insuranceNumber: { type: String, required: true },
  insuranceExpiry: { type: Date, required: true },
  isVerified: { type: Boolean, default: false },
  isApproved: { type: Boolean, default: false },

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
  this.currentLocation.coordinates = [longitude, latitude];
  this.lastActive = new Date();
  return await this.save();
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

// Static method to find nearby available drivers
driverSchema.statics.findNearbyDrivers = async function(latitude, longitude, maxDistance = 5) {
  return await this.find({
    isOnline: true,
    isAvailable: true,
    isApproved: true,
    currentLocation: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: maxDistance * 1000 // Convert km to meters
      }
    }
  }).populate('user', 'firstName lastName phone rating').limit(20);
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
