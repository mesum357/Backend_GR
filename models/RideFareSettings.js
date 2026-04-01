const mongoose = require('mongoose');

/** Admin-editable per-km only; base/min come from code (see utils/rideFarePricing.js). */
const rideFareSettingsSchema = new mongoose.Schema(
  {
    rideTypes: {
      moto: { perKm: { type: Number, min: 1, max: 500 } },
      ride_mini: { perKm: { type: Number, min: 1, max: 500 } },
      ride_ac: { perKm: { type: Number, min: 1, max: 500 } },
      premium: { perKm: { type: Number, min: 1, max: 500 } },
    },
  },
  { timestamps: true }
);

rideFareSettingsSchema.statics.getSingleton = async function getSingleton() {
  let doc = await this.findOne();
  if (!doc) {
    doc = await this.create({ rideTypes: {} });
  }
  return doc;
};

module.exports = mongoose.model('RideFareSettings', rideFareSettingsSchema);
