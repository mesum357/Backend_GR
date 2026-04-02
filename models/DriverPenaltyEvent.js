const mongoose = require('mongoose');

const driverPenaltyEventSchema = new mongoose.Schema(
  {
    driver: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver', required: true },
    rider: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rideRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'RideRequest' },
    reasonKey: { type: String, required: true, index: true },

    // For admin debugging / history
    streakCountAfter: { type: Number, default: 0 },
    appliedLevelAfter: { type: String, default: 'none' }, // none|warning|penalized
  },
  { timestamps: true }
);

driverPenaltyEventSchema.index({ driver: 1, createdAt: -1 });

module.exports = mongoose.model('DriverPenaltyEvent', driverPenaltyEventSchema);

