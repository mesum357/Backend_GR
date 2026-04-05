const mongoose = require('mongoose');

/** Purposes must match lib/riderPhoneVerification WHATSAPP_OTP_PURPOSE */
const whatsappOtpSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, trim: true },
    purpose: { type: String, required: true, trim: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, expires: 0 },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

whatsappOtpSchema.index({ phone: 1, purpose: 1 }, { unique: true });

module.exports = mongoose.model('WhatsappOtp', whatsappOtpSchema);
