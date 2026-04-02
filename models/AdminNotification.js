const mongoose = require('mongoose');

const adminNotificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 500 },
    type: { type: String, enum: ['informational', 'promotional', 'alert', 'system'], default: 'informational' },
    audience: { type: String, enum: ['all', 'riders', 'drivers'], default: 'all', index: true },
    status: { type: String, enum: ['sent', 'scheduled'], default: 'sent', index: true },
    scheduledAt: { type: Date, default: null },
    sentAt: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: true }
);

adminNotificationSchema.index({ sentAt: -1 });

module.exports = mongoose.model('AdminNotification', adminNotificationSchema);

