const mongoose = require('mongoose');

const popupAdSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    imageUrl: { type: String, default: '' }, // can be http(s) or data:
    linkUrl: { type: String, default: '' },
    audience: { type: String, enum: ['all', 'riders', 'drivers'], default: 'all', index: true },
    active: { type: Boolean, default: true, index: true },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    frequency: { type: String, enum: ['once', 'daily', 'every_session'], default: 'every_session' },
  },
  { timestamps: true }
);

popupAdSchema.index({ active: 1, createdAt: -1 });

module.exports = mongoose.model('PopupAd', popupAdSchema);

