const mongoose = require('mongoose');

const rideChatMessageSchema = new mongoose.Schema(
  {
    rideRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'RideRequest', required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    senderType: { type: String, enum: ['rider', 'driver'], required: true },
    text: { type: String, required: true },
    timestamp: { type: Number, default: () => Date.now() },
  },
  { timestamps: true }
);

rideChatMessageSchema.index({ rideRequest: 1, createdAt: 1 });

module.exports = mongoose.model('RideChatMessage', rideChatMessageSchema);

