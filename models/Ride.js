const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
  rider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  driver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  pickup: {
    address: {
      type: String,
      required: true
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number],
        required: true
      }
    }
  },
  destination: {
    address: {
      type: String,
      required: true
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number],
        required: true
      }
    }
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'started', 'completed', 'cancelled'],
    default: 'pending'
  },
  price: {
    amount: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      default: 'PKR'
    },
    negotiated: {
      type: Boolean,
      default: false
    }
  },
  distance: {
    type: Number, // in kilometers
    required: true
  },
  duration: {
    type: Number, // in minutes
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'wallet', 'card'],
    default: 'cash'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  },
  rating: {
    riderRating: {
      type: Number,
      min: 1,
      max: 5,
      default: null
    },
    driverRating: {
      type: Number,
      min: 1,
      max: 5,
      default: null
    },
    riderComment: {
      type: String,
      default: null
    },
    driverComment: {
      type: String,
      default: null
    }
  },
  startTime: {
    type: Date,
    default: null
  },
  endTime: {
    type: Date,
    default: null
  },
  cancellationReason: {
    type: String,
    default: null
  },
  cancelledBy: {
    type: String,
    enum: ['rider', 'driver', 'system'],
    default: null
  }
}, {
  timestamps: true
});

// Indexes for geospatial queries
rideSchema.index({ 'pickup.location': '2dsphere' });
rideSchema.index({ 'destination.location': '2dsphere' });
rideSchema.index({ status: 1, createdAt: -1 });
rideSchema.index({ rider: 1, createdAt: -1 });
rideSchema.index({ driver: 1, createdAt: -1 });

// Virtual for ride duration
rideSchema.virtual('actualDuration').get(function() {
  if (this.startTime && this.endTime) {
    return Math.round((this.endTime - this.startTime) / (1000 * 60)); // minutes
  }
  return null;
});

// Method to calculate estimated price
rideSchema.methods.calculateEstimatedPrice = function() {
  const basePrice = 50; // Base fare
  const perKmPrice = 15; // Price per kilometer
  const perMinutePrice = 2; // Price per minute
  
  return basePrice + (this.distance * perKmPrice) + (this.duration * perMinutePrice);
};

// Method to update ride status
rideSchema.methods.updateStatus = function(newStatus, userId = null) {
  this.status = newStatus;
  
  if (newStatus === 'started') {
    this.startTime = new Date();
  } else if (newStatus === 'completed') {
    this.endTime = new Date();
  }
  
  return this.save();
};

module.exports = mongoose.model('Ride', rideSchema);
