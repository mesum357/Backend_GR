const mongoose = require('mongoose');

const rideRequestSchema = new mongoose.Schema({
  // Rider information
  rider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  
  // Location details
  pickupLocation: {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    address: { type: String, required: true },
  },
  
  destination: {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    address: { type: String, required: true },
  },
  
  // Ride details
  distance: { type: Number, required: true }, // in km
  estimatedDuration: { type: Number, required: true }, // in minutes
  requestedPrice: { type: Number, required: true }, // rider's offered price
  suggestedPrice: { type: Number, required: true }, // system suggested price
  
  // Request status
  status: {
    type: String,
    enum: ['searching', 'pending', 'accepted', 'rejected', 'expired', 'cancelled'],
    default: 'searching',
  },
  
  // Cancellation timestamp
  cancelledAt: {
    type: Date,
  },
  
  // Driver who accepted (if any)
  acceptedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  
  // Available drivers who can see this request
  availableDrivers: [{
    driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    distance: { type: Number }, // distance from pickup
    estimatedTime: { type: Number }, // estimated arrival time
    counterOffer: { type: Number }, // driver's counter offer price
    status: {
      type: String,
      enum: ['viewed', 'interested', 'counter_offered', 'accepted'],
      default: 'viewed',
    },
    viewedAt: { type: Date },
    respondedAt: { type: Date },
  }],
  
  // Request metadata
  requestRadius: { type: Number, default: 5 }, // km radius to search for drivers
  expiresAt: { type: Date, required: true }, // when request expires
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  
  // Additional details
  notes: { type: String }, // rider's notes
  vehicleType: { type: String, default: 'any' }, // preferred vehicle type
  isUrgent: { type: Boolean, default: false },
  
  // Payment method
  paymentMethod: {
    type: String,
    enum: ['cash', 'card', 'wallet'],
    default: 'cash',
  },
});

// Index for geospatial queries
rideRequestSchema.index({ 
  'pickupLocation.latitude': 1, 
  'pickupLocation.longitude': 1 
});

// Index for status and expiration
rideRequestSchema.index({ status: 1, expiresAt: 1 });

// Pre-save middleware to update timestamp
rideRequestSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Method to find nearby drivers
rideRequestSchema.methods.findNearbyDrivers = async function(maxDistance = 5) {
  const Driver = mongoose.model('User');
  
  return await Driver.find({
    userType: 'driver',
    isOnline: true,
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [this.pickupLocation.longitude, this.pickupLocation.latitude]
        },
        $maxDistance: maxDistance * 1000 // Convert km to meters
      }
    }
  }).limit(20); // Limit to 20 nearby drivers
};

// Method to calculate distance between two points
rideRequestSchema.methods.calculateDistance = function(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = this.deg2rad(lat2 - lat1);
  const dLon = this.deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(this.deg2rad(lat1)) *
      Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

rideRequestSchema.methods.deg2rad = function(deg) {
  return deg * (Math.PI / 180);
};

// Static method to create ride request
rideRequestSchema.statics.createRequest = async function(rideData) {
  const request = new this(rideData);
  
  // Set expiration time (15 minutes from now)
  request.expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  
  // Calculate distance
  request.distance = request.calculateDistance(
    request.pickupLocation.latitude,
    request.pickupLocation.longitude,
    request.destination.latitude,
    request.destination.longitude
  );
  
  // Calculate estimated duration (assuming 30 km/h average speed)
  request.estimatedDuration = Math.round(request.distance * 2); // 2 minutes per km
  
  // Calculate suggested price (base fare + distance fare)
  const baseFare = 50; // PKR base fare
  const perKmFare = 25; // PKR per kilometer
  request.suggestedPrice = Math.round(baseFare + (request.distance * perKmFare));
  
  // If no requested price, use suggested price
  if (!request.requestedPrice) {
    request.requestedPrice = request.suggestedPrice;
  }
  
  return await request.save();
};

module.exports = mongoose.model('RideRequest', rideRequestSchema);
