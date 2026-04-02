const express = require('express');
const { authenticateAdminJWT } = require('../middleware/admin-auth');
const AdminNotification = require('../models/AdminNotification');
const PopupAd = require('../models/PopupAd');

const router = express.Router();

router.get('/notifications', authenticateAdminJWT, async (req, res) => {
  try {
    const notifications = await AdminNotification.find({})
      .sort({ sentAt: -1, createdAt: -1 })
      .limit(200)
      .lean();
    return res.json({ notifications });
  } catch {
    return res.status(500).json({ error: 'Failed to load notifications' });
  }
});

router.post('/notifications', authenticateAdminJWT, async (req, res) => {
  try {
    const { audience, title, body, type, schedule, scheduleDate } = req.body || {};

    const t = String(title || '').trim();
    const b = String(body || '').trim();
    if (!t) return res.status(400).json({ error: 'Title is required' });
    if (!b) return res.status(400).json({ error: 'Body is required' });

    const aud = ['all', 'riders', 'drivers'].includes(String(audience)) ? String(audience) : 'all';
    const nt = ['informational', 'promotional', 'alert', 'system'].includes(String(type))
      ? String(type)
      : 'informational';

    const isScheduled = !!schedule;
    const scheduledAt = isScheduled && scheduleDate ? new Date(String(scheduleDate)) : null;

    const doc = await AdminNotification.create({
      audience: aud,
      title: t,
      body: b,
      type: nt,
      status: isScheduled ? 'scheduled' : 'sent',
      scheduledAt,
      sentAt: isScheduled ? null : new Date(),
    });

    return res.status(201).json({ notification: doc });
  } catch {
    return res.status(500).json({ error: 'Failed to create notification' });
  }
});

router.delete('/notifications/:id', authenticateAdminJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await AdminNotification.findByIdAndDelete(id).lean();
    if (!deleted) return res.status(404).json({ error: 'Notification not found' });
    return res.json({ message: 'Deleted' });
  } catch {
    return res.status(500).json({ error: 'Failed to delete notification' });
  }
});

router.get('/popup-ads', authenticateAdminJWT, async (req, res) => {
  try {
    const ads = await PopupAd.find({})
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    return res.json({ ads });
  } catch {
    return res.status(500).json({ error: 'Failed to load popup ads' });
  }
});

router.post('/popup-ads', authenticateAdminJWT, async (req, res) => {
  try {
    const { title, imageUrl, linkUrl, audience, frequency, startAt, endAt, active } = req.body || {};
    const t = String(title || '').trim();
    if (!t) return res.status(400).json({ error: 'Ad title is required' });

    const aud = ['all', 'riders', 'drivers'].includes(String(audience)) ? String(audience) : 'all';
    const freq = ['once', 'daily', 'every_session'].includes(String(frequency))
      ? String(frequency)
      : 'every_session';

    const doc = await PopupAd.create({
      title: t,
      imageUrl: imageUrl ? String(imageUrl) : '',
      linkUrl: linkUrl ? String(linkUrl) : '',
      audience: aud,
      frequency: freq,
      startAt: startAt ? new Date(String(startAt)) : null,
      endAt: endAt ? new Date(String(endAt)) : null,
      active: active !== undefined ? !!active : true,
    });

    return res.status(201).json({ ad: doc });
  } catch {
    return res.status(500).json({ error: 'Failed to create popup ad' });
  }
});

router.patch('/popup-ads/:id', authenticateAdminJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { active } = req.body || {};
    const updated = await PopupAd.findByIdAndUpdate(
      id,
      { $set: { active: !!active } },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ error: 'Ad not found' });
    return res.json({ ad: updated });
  } catch {
    return res.status(500).json({ error: 'Failed to update ad' });
  }
});

router.delete('/popup-ads/:id', authenticateAdminJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await PopupAd.findByIdAndDelete(id).lean();
    if (!deleted) return res.status(404).json({ error: 'Ad not found' });
    return res.json({ message: 'Deleted' });
  } catch {
    return res.status(500).json({ error: 'Failed to delete ad' });
  }
});

module.exports = router;

