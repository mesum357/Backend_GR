const express = require('express');
const { authenticateAdminJWT } = require('../middleware/admin-auth');
const RideRequest = require('../models/RideRequest');
const RideChatMessage = require('../models/RideChatMessage');

const router = express.Router();

function normalizeStatusGroup(raw) {
  const s = String(raw || 'all').toLowerCase().trim();
  if (s === 'live' || s === 'active') return 'live';
  if (s === 'completed' || s === 'complete') return 'completed';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (s === 'all') return 'all';
  return 'all';
}

function statusQueryForGroup(group) {
  if (group === 'live') {
    return { status: { $in: ['searching', 'pending', 'accepted', 'in_progress'] } };
  }
  if (group === 'completed') {
    return { status: { $in: ['completed'] } };
  }
  if (group === 'cancelled') {
    return { status: { $in: ['cancelled', 'expired', 'rejected'] } };
  }
  return {};
}

router.get('/live-rides', authenticateAdminJWT, async (req, res) => {
  try {
    const group = normalizeStatusGroup(req.query.status);
    const q = statusQueryForGroup(group);

    const search = String(req.query.search || '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);

    const docs = await RideRequest.find(q)
      .populate('rider', 'firstName lastName phone profileImage')
      .populate('acceptedBy', 'firstName lastName phone profileImage')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const rides = (docs || []).map((r) => ({
      id: String(r._id),
      status: r.status,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      pickup: r.pickupLocation,
      destination: r.destination,
      distanceKm: r.distance,
      estimatedDurationMin: r.estimatedDuration,
      paymentMethod: r.paymentMethod,
      requestedPrice: r.requestedPrice,
      suggestedPrice: r.suggestedPrice,
      notes: r.notes || '',
      rider: r.rider
        ? {
            id: String(r.rider._id || r.rider),
            name: `${r.rider.firstName || ''} ${r.rider.lastName || ''}`.trim() || 'Rider',
            phone: r.rider.phone || '',
            profileImage: r.rider.profileImage || null,
          }
        : null,
      driver: r.acceptedBy
        ? {
            id: String(r.acceptedBy._id || r.acceptedBy),
            name: `${r.acceptedBy.firstName || ''} ${r.acceptedBy.lastName || ''}`.trim() || 'Driver',
            phone: r.acceptedBy.phone || '',
            profileImage: r.acceptedBy.profileImage || null,
          }
        : null,
      fareOffers: Array.isArray(r.fareOffers)
        ? r.fareOffers.map((o) => ({
            driverId: String(o.driver),
            driverName: o.driverName,
            fareAmount: o.fareAmount,
            arrivalTime: o.arrivalTime,
            status: o.status,
            offeredAt: o.offeredAt,
          }))
        : [],
    }));

    const filtered = !search
      ? rides
      : rides.filter((rr) => {
          const a = `${rr?.rider?.name || ''} ${rr?.driver?.name || ''} ${rr?.pickup?.address || ''} ${rr?.destination?.address || ''}`.toLowerCase();
          return a.includes(search);
        });

    return res.json({ rides: filtered, statusGroup: group });
  } catch (err) {
    console.error('admin live-rides error:', err);
    return res.status(500).json({ error: 'Failed to load live rides' });
  }
});

router.get('/live-rides/:rideRequestId/messages', authenticateAdminJWT, async (req, res) => {
  try {
    const { rideRequestId } = req.params;
    const limit = Math.min(Math.max(Number(req.query.limit || 300), 1), 1000);

    const messages = await RideChatMessage.find({ rideRequest: rideRequestId })
      .populate('sender', 'firstName lastName')
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();

    const out = (messages || []).map((m) => ({
      id: String(m._id),
      rideRequestId: String(m.rideRequest),
      senderType: m.senderType,
      senderId: String(m.sender?._id || m.sender),
      senderName: m.sender
        ? `${m.sender.firstName || ''} ${m.sender.lastName || ''}`.trim()
        : '',
      text: m.text,
      timestamp: m.timestamp || (m.createdAt ? new Date(m.createdAt).getTime() : Date.now()),
      createdAt: m.createdAt,
    }));

    return res.json({ messages: out });
  } catch (err) {
    console.error('admin live-rides messages error:', err);
    return res.status(500).json({ error: 'Failed to load ride messages' });
  }
});

module.exports = router;

