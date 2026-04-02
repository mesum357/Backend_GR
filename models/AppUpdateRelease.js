const mongoose = require('mongoose');

const appUpdateReleaseSchema = new mongoose.Schema(
  {
    app: { type: String, enum: ['all', 'rider', 'driver'], required: true, index: true },
    version: { type: String, required: true, trim: true },
    type: { type: String, enum: ['force', 'optional'], default: 'optional' },
    status: { type: String, enum: ['active', 'inactive', 'scheduled'], default: 'active', index: true },
    notes: { type: String, default: '' },
    scheduledAt: { type: Date, default: null },
    publishedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

appUpdateReleaseSchema.index({ app: 1, publishedAt: -1 });

module.exports = mongoose.model('AppUpdateRelease', appUpdateReleaseSchema);

