const express = require('express');
const { authenticateAdminJWT } = require('../middleware/admin-auth');
const User = require('../models/User');
const Driver = require('../models/Driver');
const Ride = require('../models/Ride');
const RideRequest = require('../models/RideRequest');

const router = express.Router();

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function subDays(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function monthStart(d) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function labelDay(d) {
  return new Date(d).toLocaleString('en-US', { weekday: 'short' });
}

function labelMonth(d) {
  return new Date(d).toLocaleString('en-US', { month: 'short' });
}

function labelWeek(i) {
  return `W${i}`;
}

async function totalEarningsCommission() {
  const agg = await Ride.aggregate([
    { $match: { driverCommissionAmount: { $gt: 0 }, commissionDeductedAt: { $ne: null } } },
    { $group: { _id: null, total: { $sum: '$driverCommissionAmount' } } },
  ]);
  return Number(agg?.[0]?.total || 0);
}

router.get('/dashboard', authenticateAdminJWT, async (req, res) => {
  try {
    const now = new Date();
    const weekStart = startOfDay(subDays(6)); // last 7 days window
    const monthWindowStart = monthStart(new Date(now.getFullYear(), now.getMonth() - 5, 1)); // last 6 months

    const [totalDrivers, totalRiders] = await Promise.all([
      Driver.countDocuments({ isApproved: true }),
      User.countDocuments({ userType: 'rider' }),
    ]);

    const ridesThisWeek = await RideRequest.countDocuments({ createdAt: { $gte: weekStart, $lte: now } });

    const totalEarnings = await totalEarningsCommission();

    const totalSosCases = await RideRequest.countDocuments({ emergencyStatus: { $in: ['active', 'resolved'] } });

    // Chart datasets derived from RideRequest statuses.
    // Daily: last 7 days (Mon..Sun)
    const dailyAgg = await RideRequest.aggregate([
      { $match: { createdAt: { $gte: weekStart, $lte: now } } },
      {
        $project: {
          createdAt: 1,
          isCompleted: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
          isCancelled: { $cond: [{ $in: ['$status', ['cancelled', 'expired', 'rejected']] }, 1, 0] },
          day: { $dayOfWeek: '$createdAt' }, // 1=Sun..7=Sat
        },
      },
      { $group: { _id: '$day', completed: { $sum: '$isCompleted' }, cancelled: { $sum: '$isCancelled' } } },
    ]);
    const dailyMap = new Map((dailyAgg || []).map((r) => [Number(r._id), r]));
    const dailyData = [];
    for (let i = 6; i >= 0; i--) {
      const d = subDays(i);
      const dayKey = new Date(d).getDay(); // 0..6
      const mongoDay = dayKey === 0 ? 1 : dayKey + 1; // to 1..7
      const row = dailyMap.get(mongoDay) || { completed: 0, cancelled: 0 };
      dailyData.push({ name: labelDay(d), completed: Number(row.completed || 0), cancelled: Number(row.cancelled || 0) });
    }

    // Weekly: last 4 weeks buckets
    const week0 = startOfDay(subDays(27));
    const weeklyAgg = await RideRequest.aggregate([
      { $match: { createdAt: { $gte: week0, $lte: now } } },
      {
        $project: {
          createdAt: 1,
          isCompleted: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
          isCancelled: { $cond: [{ $in: ['$status', ['cancelled', 'expired', 'rejected']] }, 1, 0] },
          weekIndex: {
            $floor: {
              $divide: [{ $subtract: ['$createdAt', week0] }, 1000 * 60 * 60 * 24 * 7],
            },
          },
        },
      },
      { $group: { _id: '$weekIndex', completed: { $sum: '$isCompleted' }, cancelled: { $sum: '$isCancelled' } } },
      { $sort: { _id: 1 } },
    ]);
    const weeklyMap = new Map((weeklyAgg || []).map((r) => [Number(r._id), r]));
    const weeklyData = [];
    for (let i = 0; i < 4; i++) {
      const row = weeklyMap.get(i) || { completed: 0, cancelled: 0 };
      weeklyData.push({ name: labelWeek(i + 1), completed: Number(row.completed || 0), cancelled: Number(row.cancelled || 0) });
    }

    // Monthly: last 6 months buckets
    const monthlyAgg = await RideRequest.aggregate([
      { $match: { createdAt: { $gte: monthWindowStart, $lte: now } } },
      {
        $project: {
          createdAt: 1,
          isCompleted: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
          isCancelled: { $cond: [{ $in: ['$status', ['cancelled', 'expired', 'rejected']] }, 1, 0] },
          y: { $year: '$createdAt' },
          m: { $month: '$createdAt' },
        },
      },
      { $group: { _id: { y: '$y', m: '$m' }, completed: { $sum: '$isCompleted' }, cancelled: { $sum: '$isCancelled' } } },
      { $sort: { '_id.y': 1, '_id.m': 1 } },
    ]);
    const monthlyMap = new Map(
      (monthlyAgg || []).map((r) => [`${r._id.y}-${r._id.m}`, r])
    );
    const monthlyData = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      const row = monthlyMap.get(key) || { completed: 0, cancelled: 0 };
      monthlyData.push({ name: labelMonth(d), completed: Number(row.completed || 0), cancelled: Number(row.cancelled || 0) });
    }

    // Recent rides: use RideRequest (live/completed/cancelled)
    const recentReqs = await RideRequest.find({})
      .populate('rider', 'firstName lastName')
      .populate('acceptedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    const recentRides = (recentReqs || []).map((r) => {
      const fare =
        (r.fareOffers || []).find((o) => o.status === 'accepted')?.fareAmount ||
        (r.fareOffers || [])[0]?.fareAmount ||
        r.requestedPrice ||
        0;
      const riderName = r.rider ? `${r.rider.firstName || ''} ${r.rider.lastName || ''}`.trim() : '—';
      const driverName = r.acceptedBy ? `${r.acceptedBy.firstName || ''} ${r.acceptedBy.lastName || ''}`.trim() : '—';
      return {
        id: String(r._id),
        rider: riderName || '—',
        driver: driverName || '—',
        fare,
        status: String(r.status || ''),
        createdAt: r.createdAt,
      };
    });

    // Top drivers: by totalRides (from Driver profile) and rating
    const topDriversDocs = await Driver.find({ isApproved: true })
      .populate('user', 'firstName lastName')
      .sort({ totalRides: -1, rating: -1 })
      .limit(5)
      .lean();
    const topDrivers = (topDriversDocs || []).map((d) => ({
      name: d.user ? `${d.user.firstName || ''} ${d.user.lastName || ''}`.trim() : '—',
      rides: Number(d.totalRides || 0),
      rating: Math.round(Number(d.rating || 0) * 10) / 10,
    }));

    return res.json({
      stats: {
        totalDrivers,
        totalRiders,
        ridesThisWeek,
        totalEarnings,
        totalSosCases,
      },
      charts: {
        daily: dailyData,
        weekly: weeklyData,
        monthly: monthlyData,
      },
      recentRides,
      topDrivers,
    });
  } catch (err) {
    console.error('admin dashboard error:', err);
    return res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

module.exports = router;

