const mongoose = require('mongoose');
const { getSystemSettings } = require('../lib/systemSettings');

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
    // Keep this aligned with backend socket/route handlers (server.js uses
    // 'in_progress' and 'completed' during the ride lifecycle).
    enum: [
      'searching',
      'pending',
      'accepted',
      'rejected',
      'expired',
      'cancelled',
      'in_progress',
      'completed',
    ],
    default: 'searching',
  },
  
  // Cancellation timestamp
  cancelledAt: {
    type: Date,
  },
  // Rider confirmed arrival at pickup (used to persist progress when reopening UI)
  riderArrivedAt: {
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

  // Fare offers from drivers
  fareOffers: [{
    driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    driverName: { type: String, required: true },
    driverRating: { type: Number, default: 4.5 },
    fareAmount: { type: Number, required: true },
    arrivalTime: { type: Number, required: true }, // in minutes
    vehicleInfo: { type: String, default: 'Standard Vehicle' },
    vehicleName: { type: String, default: '' },
    driverPhoto: { type: String, default: '' },
    offeredAt: { type: Date, default: Date.now },
    respondedAt: { type: Date },
    status: {
      type: String,
      // server.js stores fare offer state as 'pending' and then maps accept/decline
      // to 'accepted'/'rejected' for persistence.
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending',
    }
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

  /** Rider-triggered emergency (e.g. Police 15); surfaced in admin Emergency Monitoring */
  emergencyStatus: {
    type: String,
    enum: ['none', 'active', 'resolved'],
    default: 'none',
    index: true,
  },
  emergencyTriggeredAt: { type: Date, default: null },
  emergencyResolvedAt: { type: Date, default: null },

  /** Encoded Directions overview polyline — computed once server-side when ride is matched (Rule 3). */
  routeOverviewPolyline: { type: String, default: '' },
  
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
  const Driver = mongoose.model('Driver');

  // Reuse Driver model's geospatial query and also apply penalty deactivation filters.
  const drivers = await Driver.findNearbyDrivers(
    this.pickupLocation.latitude,
    this.pickupLocation.longitude,
    maxDistance
  );

  // Legacy shape expected by `routes/ride-requests.js` `/create` endpoint.
  // That endpoint expects:
  // - `driver._id` to be the *User* (driver) id
  // - `driver.location.coordinates` to be [longitude, latitude]
  return drivers.map((d) => ({
    _id: d?.user?._id || d?.user || d?._id,
    location: {
      coordinates: d?.currentLocation?.coordinates || [this.pickupLocation.longitude, this.pickupLocation.latitude],
    },
  }));
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

  const systemSettings = await getSystemSettings();

  // Set expiration time (admin-configured) while searching for drivers.
  request.expiresAt = new Date(Date.now() + Number(systemSettings.driverTimeoutSeconds) * 1000);

  // If caller didn't provide a radius, use admin-configured max ride radius.
  if (rideData?.requestRadius == null) {
    request.requestRadius = Number(systemSettings.maxRideRadiusKm);
  }
  
  // Calculate distance
  request.distance = request.calculateDistance(
    request.pickupLocation.latitude,
    request.pickupLocation.longitude,
    request.destination.latitude,
    request.destination.longitude
  );
  
  // Calculate estimated duration (assuming 30 km/h average speed)
  request.estimatedDuration = Math.round(request.distance * 2); // 2 minutes per km
  
  const { getSuggestedPrice } = require('../utils/rideFarePricing');
  request.suggestedPrice = await getSuggestedPrice(request.distance, request.vehicleType);
  
  // If no requested price, use suggested price
  if (!request.requestedPrice) {
    request.requestedPrice = request.suggestedPrice;
  }
  
  return await request.save();
};

module.exports = mongoose.model('RideRequest', rideRequestSchema);
