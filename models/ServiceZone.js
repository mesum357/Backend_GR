const mongoose = require('mongoose');

const serviceZoneSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    city: { type: String, required: true, trim: true, maxlength: 120 },
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    /**
     * When false: service is NOT available in this area (app should show message).
     * When true: service is available.
     */
    isActive: { type: Boolean, default: false },
    /**
     * Radius (km) from (latitude, longitude) considered part of this zone.
     * Since Admin UI only collects lat/long, we use a default.
     */
    radiusKm: { type: Number, default: 2, min: 0.1, max: 200 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ServiceZone', serviceZoneSchema);

