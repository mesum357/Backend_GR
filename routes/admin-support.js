const express = require('express');
const SupportTicket = require('../models/SupportTicket');
const SupportMessage = require('../models/SupportMessage');
const { authenticateAdminJWT } = require('../middleware/admin-auth');

const router = express.Router();

router.get('/support/tickets', authenticateAdminJWT, async (req, res) => {
  try {
    const status = String(req.query.status || 'all');
    const q = {};
    if (status === 'open') q.status = { $in: ['open', 'answered'] };
    else if (status === 'closed') q.status = 'closed';

    const tickets = await SupportTicket.find(q)
      .populate('user', 'firstName lastName email phone userType')
      .sort({ lastMessageAt: -1 })
      .limit(200)
      .lean();

    return res.json({ tickets });
  } catch (err) {
    console.error('admin list support tickets error:', err);
    return res.status(500).json({ error: 'Failed to list tickets' });
  }
});

router.get('/support/tickets/:ticketId', authenticateAdminJWT, async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.ticketId)
      .populate('user', 'firstName lastName email phone userType')
      .lean();
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const messages = await SupportMessage.find({ ticket: ticket._id }).sort({ createdAt: 1 }).lean();
    return res.json({ ticket, messages });
  } catch (err) {
    console.error('admin get support ticket error:', err);
    return res.status(500).json({ error: 'Failed to load ticket' });
  }
});

router.post('/support/tickets/:ticketId/messages', authenticateAdminJWT, async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const body = String((req.body || {}).message || '').trim();
    if (!body || body.length > 8000) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const row = new SupportMessage({ ticket: ticket._id, sender: 'admin', body });
    await row.save();
    ticket.lastMessageAt = new Date();
    ticket.status = 'answered';
    ticket.unreadForUser = true;
    await ticket.save();

    const messages = await SupportMessage.find({ ticket: ticket._id }).sort({ createdAt: 1 }).lean();
    const populated = await SupportTicket.findById(ticket._id)
      .populate('user', 'firstName lastName email phone userType')
      .lean();
    return res.json({ ticket: populated, messages });
  } catch (err) {
    console.error('admin reply support error:', err);
    return res.status(500).json({ error: 'Failed to send reply' });
  }
});

router.patch('/support/tickets/:ticketId/close', authenticateAdminJWT, async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    ticket.status = 'closed';
    await ticket.save();
    return res.json({ ticket: ticket.toObject() });
  } catch (err) {
    console.error('admin close ticket error:', err);
    return res.status(500).json({ error: 'Failed to close ticket' });
  }
});

module.exports = router;
