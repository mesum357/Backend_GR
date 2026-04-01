const express = require('express');
const crypto = require('crypto');
const SupportTicket = require('../models/SupportTicket');
const SupportMessage = require('../models/SupportMessage');
const User = require('../models/User');
const { authenticateJWT } = require('../middleware/auth');
const { ISSUE_CATEGORIES } = require('../models/SupportTicket');

const router = express.Router();

function makeTicketRef() {
  const t = Date.now().toString(36).toUpperCase();
  const r = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TKT-${t}-${r}`;
}

function roleFromUser(user) {
  const t = String(user.userType || 'rider').toLowerCase();
  return t === 'driver' ? 'driver' : 'rider';
}

/** Active ticket (open or answered) for current user, with recent messages */
router.get('/active', authenticateJWT, async (req, res) => {
  try {
    const ticket = await SupportTicket.findOne({
      user: req.user.id,
      status: { $in: ['open', 'answered'] },
    })
      .sort({ updatedAt: -1 })
      .lean();

    if (!ticket) {
      return res.json({ ticket: null, messages: [] });
    }

    const messages = await SupportMessage.find({ ticket: ticket._id })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();

    return res.json({ ticket, messages });
  } catch (err) {
    console.error('support active error:', err);
    return res.status(500).json({ error: 'Failed to load support ticket' });
  }
});

/** Create ticket + first message (one active ticket per user; reuse if already open) */
router.post('/tickets', authenticateJWT, async (req, res) => {
  try {
    const { issueCategory, title, message, displayName } = req.body || {};
    const cat = String(issueCategory || '').toLowerCase();
    if (!ISSUE_CATEGORIES.includes(cat)) {
      return res.status(400).json({ error: 'Invalid issue category' });
    }
    const tit = String(title || '').trim();
    const msg = String(message || '').trim();
    if (!tit || tit.length > 200) {
      return res.status(400).json({ error: 'Title is required (max 200 characters)' });
    }
    if (!msg || msg.length > 8000) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const existing = await SupportTicket.findOne({
      user: req.user.id,
      status: { $in: ['open', 'answered'] },
    }).sort({ updatedAt: -1 });

    if (existing) {
      const messages = await SupportMessage.find({ ticket: existing._id }).sort({ createdAt: 1 }).lean();
      return res.status(200).json({
        reused: true,
        ticket: existing.toObject(),
        messages,
      });
    }

    const userDoc = await User.findById(req.user.id).select('firstName lastName userType').lean();
    const defaultName = [userDoc?.firstName, userDoc?.lastName].filter(Boolean).join(' ').trim() || 'User';
    const snapName = String(displayName || '').trim() || defaultName;

    const ticket = new SupportTicket({
      user: req.user.id,
      ticketRef: makeTicketRef(),
      issueCategory: cat,
      title: tit,
      displayName: snapName.slice(0, 200),
      userRole: roleFromUser(userDoc || req.user),
      status: 'open',
      lastMessageAt: new Date(),
    });
    await ticket.save();

    const first = new SupportMessage({
      ticket: ticket._id,
      sender: 'user',
      body: msg,
    });
    await first.save();

    const messages = await SupportMessage.find({ ticket: ticket._id }).sort({ createdAt: 1 }).lean();
    return res.status(201).json({ ticket: ticket.toObject(), messages });
  } catch (err) {
    console.error('support create ticket error:', err);
    return res.status(500).json({ error: 'Failed to create support ticket' });
  }
});

/** List all tickets for the current user (newest first) */
router.get('/tickets', authenticateJWT, async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ user: req.user.id })
      .sort({ updatedAt: -1 })
      .limit(100)
      .select('ticketRef issueCategory title displayName userRole status lastMessageAt createdAt updatedAt')
      .lean();

    return res.json({ tickets });
  } catch (err) {
    console.error('support list tickets error:', err);
    return res.status(500).json({ error: 'Failed to list tickets' });
  }
});

router.get('/tickets/:ticketId/messages', authenticateJWT, async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.ticketId).lean();
    if (!ticket || String(ticket.user) !== String(req.user.id)) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    const messages = await SupportMessage.find({ ticket: ticket._id }).sort({ createdAt: 1 }).limit(500).lean();
    return res.json({ ticket, messages });
  } catch (err) {
    console.error('support list messages error:', err);
    return res.status(500).json({ error: 'Failed to load messages' });
  }
});

router.post('/tickets/:ticketId/messages', authenticateJWT, async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.ticketId);
    if (!ticket || String(ticket.user) !== String(req.user.id)) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    if (ticket.status === 'closed') {
      return res.status(400).json({ error: 'This ticket is closed' });
    }
    const msg = String((req.body || {}).message || '').trim();
    if (!msg || msg.length > 8000) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const row = new SupportMessage({ ticket: ticket._id, sender: 'user', body: msg });
    await row.save();
    ticket.lastMessageAt = new Date();
    ticket.status = 'open';
    await ticket.save();

    const messages = await SupportMessage.find({ ticket: ticket._id }).sort({ createdAt: 1 }).lean();
    return res.json({ ticket: ticket.toObject(), messages });
  } catch (err) {
    console.error('support post message error:', err);
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

module.exports = router;
