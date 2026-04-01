const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    rideType: {
      type: String,
      required: true,
      enum: ['Moto', 'Ride Mini', 'Ride With AC', 'Premium'],
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

vehicleSchema.index({ name: 1 }, { unique: true });
vehicleSchema.index({ isActive: 1 });

module.exports = mongoose.model('Vehicle', vehicleSchema);

