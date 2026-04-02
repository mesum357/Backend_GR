const express = require('express');
const { authenticateAdminJWT } = require('../middleware/admin-auth');
const AppUpdateRelease = require('../models/AppUpdateRelease');
const { getAppUpdateSettings, patchAppUpdateSettings } = require('../lib/appUpdateSettings');

const router = express.Router();

router.get('/app-updates/settings', authenticateAdminJWT, async (req, res) => {
  try {
    const settings = await getAppUpdateSettings();
    return res.json(settings);
  } catch {
    return res.status(500).json({ error: 'Failed to load app update settings' });
  }
});

router.patch('/app-updates/settings', authenticateAdminJWT, async (req, res) => {
  try {
    const settings = await patchAppUpdateSettings(req.body || {});
    return res.json(settings);
  } catch (e) {
    return res.status(e?.statusCode || 500).json({ error: e?.message || 'Failed to update app update settings' });
  }
});

router.get('/app-updates/releases', authenticateAdminJWT, async (req, res) => {
  try {
    const releases = await AppUpdateRelease.find({})
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(100)
      .lean();
    return res.json({ releases });
  } catch {
    return res.status(500).json({ error: 'Failed to load release history' });
  }
});

router.post('/app-updates/releases', authenticateAdminJWT, async (req, res) => {
  try {
    const { version, type, notes, schedule, scheduleDate } = req.body || {};

    const v = String(version || '').trim();
    if (!v) return res.status(400).json({ error: 'Version is required' });

    const t = type === 'force' ? 'force' : 'optional';
    const isScheduled = !!schedule;
    const scheduledAt = isScheduled && scheduleDate ? new Date(String(scheduleDate)) : null;
    const status = isScheduled ? 'scheduled' : 'active';

    const created = await AppUpdateRelease.create({
      app: 'all',
      version: v,
      type: t,
      status,
      notes: notes ? String(notes) : '',
      scheduledAt,
      publishedAt: new Date(),
    });

    // Convenience: update current version; if force release, also bump minVersion.
    const patch = { currentVersion: v };
    if (t === 'force') patch.minVersion = v;
    await patchAppUpdateSettings(patch);

    return res.status(201).json({ release: created });
  } catch {
    return res.status(500).json({ error: 'Failed to publish release' });
  }
});

router.patch('/app-updates/releases/:id/reactivate', authenticateAdminJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await AppUpdateRelease.findByIdAndUpdate(
      id,
      { $set: { status: 'active' } },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ error: 'Release not found' });
    return res.json({ release: updated });
  } catch {
    return res.status(500).json({ error: 'Failed to reactivate release' });
  }
});

module.exports = router;

