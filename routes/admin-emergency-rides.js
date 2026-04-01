const express = require('express');
const RideRequest = require('../models/RideRequest');
const Driver = require('../models/Driver');
const { authenticateAdminJWT } = require('../middleware/admin-auth');

const router = express.Router();

function formatReportText(doc, driverProfile, riderUser) {
  const lines = [
    'GB RIDES — EMERGENCY CASE REPORT',
    '================================',
    '',
    `Generated (UTC): ${new Date().toISOString()}`,
    '',
    'RIDE',
    `  Request ID: ${doc._id}`,
    `  Status: ${doc.status}`,
    `  Vehicle type: ${doc.vehicleType || '—'}`,
    `  Requested fare (PKR): ${doc.requestedPrice}`,
    `  Distance (km): ${doc.distance}`,
    `  Ride created: ${doc.createdAt}`,
    `  Emergency triggered: ${doc.emergencyTriggeredAt || '—'}`,
    `  Emergency resolved: ${doc.emergencyResolvedAt || '—'}`,
    `  Emergency status: ${doc.emergencyStatus}`,
    '',
    'PICKUP',
    `  ${doc.pickupLocation?.address || '—'}`,
    `  Lat/Lng: ${doc.pickupLocation?.latitude}, ${doc.pickupLocation?.longitude}`,
    '',
    'DESTINATION',
    `  ${doc.destination?.address || '—'}`,
    `  Lat/Lng: ${doc.destination?.latitude}, ${doc.destination?.longitude}`,
    '',
    'RIDER',
    `  Name: ${[riderUser?.firstName, riderUser?.lastName].filter(Boolean).join(' ') || '—'}`,
    `  Phone: ${riderUser?.phone || '—'}`,
    `  Email: ${riderUser?.email || '—'}`,
    '',
    'DRIVER',
    `  Name: ${driverProfile?.user ? `${driverProfile.user.firstName || ''} ${driverProfile.user.lastName || ''}`.trim() : '—'}`,
    `  Phone: ${driverProfile?.user?.phone || '—'}`,
    `  Email: ${driverProfile?.user?.email || '—'}`,
    `  Rating: ${driverProfile?.rating ?? driverProfile?.user?.rating ?? '—'}`,
    `  Vehicle: ${driverProfile?.vehicleInfo ? `${driverProfile.vehicleInfo.color || ''} ${driverProfile.vehicleInfo.make || ''} ${driverProfile.vehicleInfo.model || ''}`.trim() : '—'}`,
    `  Plate: ${driverProfile?.vehicleInfo?.plateNumber || '—'}`,
    '',
    '--- End of report — submit to authorities as needed.',
    '',
  ];
  return lines.join('\n');
}

/** List emergency-flagged rides */
router.get('/emergency-rides', authenticateAdminJWT, async (req, res) => {
  try {
    const q = String(req.query.status || 'all').toLowerCase();
    const filter = { emergencyStatus: { $ne: 'none' } };
    if (q === 'active') filter.emergencyStatus = 'active';
    else if (q === 'resolved') filter.emergencyStatus = 'resolved';

    const rides = await RideRequest.find(filter)
      .populate('rider', 'firstName lastName email phone rating')
      .populate('acceptedBy', 'firstName lastName email phone rating')
      .sort({ emergencyTriggeredAt: -1, updatedAt: -1 })
      .limit(200)
      .lean();

    const enriched = await Promise.all(
      rides.map(async (row) => {
        const driverProfile = row.acceptedBy
          ? await Driver.findOne({ user: row.acceptedBy._id })
              .populate('user', 'firstName lastName email phone rating')
              .select('vehicleInfo rating user')
              .lean()
          : null;
        return { ...row, driverProfile };
      })
    );

    const [activeCount, resolvedToday] = await Promise.all([
      RideRequest.countDocuments({ emergencyStatus: 'active' }),
      RideRequest.countDocuments({
        emergencyStatus: 'resolved',
        emergencyResolvedAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      }),
    ]);

    const totalEver = await RideRequest.countDocuments({ emergencyStatus: { $ne: 'none' } });

    return res.json({
      rides: enriched,
      stats: {
        active: activeCount,
        resolvedToday,
        totalEver,
      },
    });
  } catch (err) {
    console.error('admin emergency-rides list error:', err);
    return res.status(500).json({ error: 'Failed to list emergency rides' });
  }
});

/** Mark emergency as resolved */
router.patch('/emergency-rides/:rideRequestId/resolve', authenticateAdminJWT, async (req, res) => {
  try {
    const ride = await RideRequest.findById(req.params.rideRequestId);
    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    if (ride.emergencyStatus === 'none') {
      return res.status(400).json({ error: 'This ride is not an emergency case' });
    }
    ride.emergencyStatus = 'resolved';
    ride.emergencyResolvedAt = new Date();
    await ride.save();
    return res.json({
      message: 'Marked as resolved',
      rideRequest: {
        id: ride._id,
        emergencyStatus: ride.emergencyStatus,
        emergencyResolvedAt: ride.emergencyResolvedAt,
      },
    });
  } catch (err) {
    console.error('admin emergency resolve error:', err);
    return res.status(500).json({ error: 'Failed to resolve emergency' });
  }
});

/** Plain-text report for police / records */
router.get('/emergency-rides/:rideRequestId/report', authenticateAdminJWT, async (req, res) => {
  try {
    const ride = await RideRequest.findById(req.params.rideRequestId)
      .populate('rider')
      .populate('acceptedBy')
      .lean();

    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    if (ride.emergencyStatus === 'none') {
      return res.status(400).json({ error: 'Not an emergency case' });
    }

    const driverProfile = ride.acceptedBy
      ? await Driver.findOne({ user: ride.acceptedBy._id })
          .populate('user', 'firstName lastName email phone rating')
          .select('vehicleInfo rating user')
          .lean()
      : null;

    const text = formatReportText(ride, driverProfile, ride.rider);
    const filename = `gb-rides-emergency-${ride._id}.txt`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(text);
  } catch (err) {
    console.error('admin emergency report error:', err);
    return res.status(500).json({ error: 'Failed to build report' });
  }
});

module.exports = router;
