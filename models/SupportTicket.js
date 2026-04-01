const mongoose = require('mongoose');

const ISSUE_CATEGORIES = ['payment', 'ride', 'account', 'app', 'other'];

const supportTicketSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** Human-readable id, e.g. TKT-A1B2C3 */
    ticketRef: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    issueCategory: {
      type: String,
      enum: ISSUE_CATEGORIES,
      required: true,
    },
    title: {
      type: String,
      required: true,
      maxlength: 200,
      trim: true,
    },
    /** Snapshot for admin list */
    displayName: { type: String, default: '', trim: true },
    userRole: {
      type: String,
      enum: ['rider', 'driver'],
      required: true,
    },
    status: {
      type: String,
      enum: ['open', 'answered', 'closed'],
      default: 'open',
      index: true,
    },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

supportTicketSchema.index({ user: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
module.exports.ISSUE_CATEGORIES = ISSUE_CATEGORIES;
