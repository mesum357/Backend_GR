const mongoose = require('mongoose');

const emailVerificationOtpSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    purpose: { type: String, required: true, trim: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

emailVerificationOtpSchema.index({ email: 1, purpose: 1 }, { unique: true });

module.exports = mongoose.model('EmailVerificationOtp', emailVerificationOtpSchema);
