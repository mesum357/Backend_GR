const express = require('express');
const { authenticateAdminJWT } = require('../middleware/admin-auth');
const Ride = require('../models/Ride');

const router = express.Router();

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfMonth(d) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0..6
  const diff = (day + 6) % 7; // Monday=0
  x.setDate(x.getDate() - diff);
  return x;
}

function periodWindow(period) {
  const now = new Date();
  if (period === 'week') return { start: startOfWeek(now), end: now, bucket: 'day', points: 7 };
  if (period === 'year') return { start: new Date(now.getFullYear(), 0, 1), end: now, bucket: 'month', points: 12 };
  // default month: last 30 days
  const start = startOfDay(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
  return { start, end: now, bucket: 'day', points: 30 };
}

function labelForBucket(date, bucket) {
  const d = new Date(date);
  if (bucket === 'month') return d.toLocaleString('en-US', { month: 'short' });
  return d.toLocaleString('en-US', { month: 'short', day: '2-digit' });
}

router.get('/financial-dashboard', authenticateAdminJWT, async (req, res) => {
  try {
    const period = String(req.query.period || 'month').toLowerCase(); // week|month|year
    const { start, end, bucket } = periodWindow(period);

    // TOTAL revenue = sum of all commission earnings from all rides (historical).
    const totalRevenueAgg = await Ride.aggregate([
      {
        $match: {
          driverCommissionAmount: { $gt: 0 },
          commissionDeductedAt: { $ne: null },
        },
      },
      { $group: { _id: null, total: { $sum: '$driverCommissionAmount' } } },
    ]);
    const totalRevenue = Number(totalRevenueAgg?.[0]?.total || 0);

    // Period revenue (commission only)
    const periodRevenueAgg = await Ride.aggregate([
      {
        $match: {
          driverCommissionAmount: { $gt: 0 },
          commissionDeductedAt: { $ne: null },
          commissionDeductedAt: { $gte: start, $lte: end },
        },
      },
      { $group: { _id: null, total: { $sum: '$driverCommissionAmount' } } },
    ]);
    const periodRevenue = Number(periodRevenueAgg?.[0]?.total || 0);

    const totalsAgg = await Ride.aggregate([
      { $match: { createdAt: { $lte: end } } },
      {
        $group: {
          _id: null,
          totalRides: { $sum: 1 },
          completedRides: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
          },
          cancelledRides: {
            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] },
          },
          avgFare: { $avg: '$price.amount' },
        },
      },
    ]);
    const totals = totalsAgg?.[0] || {};

    // Revenue over time (commission) in buckets for selected period.
    const groupId =
      bucket === 'month'
        ? { y: { $year: '$commissionDeductedAt' }, m: { $month: '$commissionDeductedAt' } }
        : { y: { $year: '$commissionDeductedAt' }, m: { $month: '$commissionDeductedAt' }, d: { $dayOfMonth: '$commissionDeductedAt' } };

    const revenueSeriesAgg = await Ride.aggregate([
      {
        $match: {
          driverCommissionAmount: { $gt: 0 },
          commissionDeductedAt: { $ne: null },
          commissionDeductedAt: { $gte: start, $lte: end },
        },
      },
      { $group: { _id: groupId, total: { $sum: '$driverCommissionAmount' } } },
      { $sort: { '_id.y': 1, '_id.m': 1, ...(bucket === 'day' ? { '_id.d': 1 } : {}) } },
    ]);

    const revenueOverTime = (revenueSeriesAgg || []).map((row) => {
      const y = row._id?.y;
      const m = row._id?.m;
      const d = row._id?.d;
      const dt = bucket === 'month' ? new Date(y, m - 1, 1) : new Date(y, m - 1, d || 1);
      return { name: labelForBucket(dt, bucket), revenue: Number(row.total || 0) };
    });

    // Revenue by ride type (commission only), within selected period.
    const revenueByRideTypeAgg = await Ride.aggregate([
      {
        $match: {
          driverCommissionAmount: { $gt: 0 },
          commissionDeductedAt: { $ne: null },
          commissionDeductedAt: { $gte: start, $lte: end },
        },
      },
      { $group: { _id: '$rideType', revenue: { $sum: '$driverCommissionAmount' } } },
      { $sort: { revenue: -1 } },
    ]);
    const revenueByRideType = (revenueByRideTypeAgg || []).map((r) => ({
      key: String(r._id || 'unknown'),
      revenue: Number(r.revenue || 0),
    }));

    // Top earning drivers (by driver earnings = fare - commission) within selected period.
    const topDriversAgg = await Ride.aggregate([
      {
        $match: {
          status: 'completed',
          driver: { $ne: null },
          createdAt: { $gte: start, $lte: end },
          'price.amount': { $gt: 0 },
        },
      },
      {
        $project: {
          driver: 1,
          fare: '$price.amount',
          commission: { $ifNull: ['$driverCommissionAmount', 0] },
        },
      },
      { $addFields: { earnings: { $max: [{ $subtract: ['$fare', '$commission'] }, 0] } } },
      { $group: { _id: '$driver', earnings: { $sum: '$earnings' } } },
      { $sort: { earnings: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'driverUser',
        },
      },
      { $unwind: { path: '$driverUser', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          driverId: { $toString: '$_id' },
          name: {
            $trim: {
              input: { $concat: [{ $ifNull: ['$driverUser.firstName', ''] }, ' ', { $ifNull: ['$driverUser.lastName', ''] }] },
            },
          },
          earnings: 1,
        },
      },
    ]);

    // Recent transactions (completed rides) — last 20 overall, not limited by period.
    const recent = await Ride.find({ status: 'completed' })
      .populate('driver', 'firstName lastName phone')
      .populate('rider', 'firstName lastName phone')
      .sort({ endTime: -1, updatedAt: -1, createdAt: -1 })
      .limit(20)
      .lean();

    const transactions = (recent || []).map((ride) => {
      const fare = Number(ride?.price?.amount || 0);
      const platform = Number(ride?.driverCommissionAmount || 0);
      const driverEarnings = Math.max(fare - platform, 0);
      const dt = ride?.endTime || ride?.updatedAt || ride?.createdAt;
      return {
        id: String(ride._id),
        date: dt ? new Date(dt).toLocaleDateString() : '',
        driver: ride.driver
          ? `${ride.driver.firstName || ''} ${ride.driver.lastName || ''}`.trim()
          : '—',
        rider: ride.rider
          ? `${ride.rider.firstName || ''} ${ride.rider.lastName || ''}`.trim()
          : '—',
        type: String(ride.rideType || 'ride_mini'),
        fare,
        platform,
        driverEarnings,
      };
    });

    return res.json({
      period,
      totals: {
        totalRevenue,
        periodRevenue,
        totalRides: Number(totals.totalRides || 0),
        totalDrivers: null,
        totalRiders: null,
        avgFare: Number(totals.avgFare || 0),
      },
      revenueOverTime,
      revenueByRideType,
      topEarners: topDriversAgg,
      transactions,
    });
  } catch (err) {
    console.error('admin financial-dashboard error:', err);
    return res.status(500).json({ error: 'Failed to load financial dashboard' });
  }
});

module.exports = router;

