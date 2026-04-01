const mongoose = require('mongoose');

const supportMessageSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SupportTicket',
      required: true,
      index: true,
    },
    sender: {
      type: String,
      enum: ['user', 'admin'],
      required: true,
    },
    body: {
      type: String,
      required: true,
      maxlength: 8000,
      trim: true,
    },
  },
  { timestamps: true }
);

supportMessageSchema.index({ ticket: 1, createdAt: 1 });

module.exports = mongoose.model('SupportMessage', supportMessageSchema);
