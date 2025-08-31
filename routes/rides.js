const express = require('express');
const Ride = require('../models/Ride');
const User = require('../models/User');
const { authenticateJWT, requireUserType } = require('../middleware/auth');
const router = express.Router();

// Book a new ride
router.post('/book', authenticateJWT, requireUserType('rider'), async (req, res) => {
  try {
    const { pickup, destination, distance, duration, paymentMethod } = req.body;

    // Calculate estimated price
    const estimatedPrice = Ride.prototype.calculateEstimatedPrice.call({
      distance,
      duration
    });

    const ride = new Ride({
      rider: req.user._id,
      pickup,
      destination,
      distance,
      duration,
      price: {
        amount: estimatedPrice,
        currency: 'PKR'
      },
      paymentMethod: paymentMethod || 'cash'
    });

    await ride.save();

    // Populate rider details
    await ride.populate('rider', 'firstName lastName phone rating');

    res.status(201).json({
      message: 'Ride booked successfully',
      ride
    });

  } catch (error) {
    console.error('Book ride error:', error);
    res.status(500).json({ error: 'Failed to book ride' });
  }
});

// Get available rides for drivers
router.get('/available', authenticateJWT, requireUserType('driver'), async (req, res) => {
  try {
    const { latitude, longitude, radius = 5000 } = req.query; // radius in meters

    const rides = await Ride.find({
      status: 'pending',
      driver: null
    }).populate('rider', 'firstName lastName rating');

    // Filter rides by distance if coordinates provided
    let filteredRides = rides;
    if (latitude && longitude) {
      filteredRides = rides.filter(ride => {
        const distance = calculateDistance(
          parseFloat(latitude),
          parseFloat(longitude),
          ride.pickup.location.coordinates[1],
          ride.pickup.location.coordinates[0]
        );
        return distance <= radius / 1000; // Convert to km
      });
    }

    res.json({
      rides: filteredRides
    });

  } catch (error) {
    console.error('Get available rides error:', error);
    res.status(500).json({ error: 'Failed to get available rides' });
  }
});

// Accept a ride (driver)
router.put('/:rideId/accept', authenticateJWT, requireUserType('driver'), async (req, res) => {
  try {
    const { rideId } = req.params;

    const ride = await Ride.findById(rideId);
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    if (ride.status !== 'pending') {
      return res.status(400).json({ error: 'Ride is no longer available' });
    }

    if (ride.driver) {
      return res.status(400).json({ error: 'Ride already accepted by another driver' });
    }

    ride.driver = req.user._id;
    ride.status = 'accepted';
    await ride.save();

    await ride.populate(['rider', 'driver'], 'firstName lastName phone rating');

    res.json({
      message: 'Ride accepted successfully',
      ride
    });

  } catch (error) {
    console.error('Accept ride error:', error);
    res.status(500).json({ error: 'Failed to accept ride' });
  }
});

// Start a ride
router.put('/:rideId/start', authenticateJWT, async (req, res) => {
  try {
    const { rideId } = req.params;

    const ride = await Ride.findById(rideId);
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    // Check if user is the driver or rider
    if (ride.driver.toString() !== req.user._id.toString() && 
        ride.rider.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (ride.status !== 'accepted') {
      return res.status(400).json({ error: 'Ride must be accepted before starting' });
    }

    ride.status = 'started';
    ride.startTime = new Date();
    await ride.save();

    await ride.populate(['rider', 'driver'], 'firstName lastName phone rating');

    res.json({
      message: 'Ride started successfully',
      ride
    });

  } catch (error) {
    console.error('Start ride error:', error);
    res.status(500).json({ error: 'Failed to start ride' });
  }
});

// Complete a ride
router.put('/:rideId/complete', authenticateJWT, async (req, res) => {
  try {
    const { rideId } = req.params;

    const ride = await Ride.findById(rideId);
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    // Check if user is the driver or rider
    if (ride.driver.toString() !== req.user._id.toString() && 
        ride.rider.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (ride.status !== 'started') {
      return res.status(400).json({ error: 'Ride must be started before completing' });
    }

    ride.status = 'completed';
    ride.endTime = new Date();
    await ride.save();

    // Update user statistics
    await User.findByIdAndUpdate(ride.rider, { $inc: { totalRides: 1 } });
    if (ride.driver) {
      await User.findByIdAndUpdate(ride.driver, { $inc: { totalRides: 1 } });
    }

    await ride.populate(['rider', 'driver'], 'firstName lastName phone rating');

    res.json({
      message: 'Ride completed successfully',
      ride
    });

  } catch (error) {
    console.error('Complete ride error:', error);
    res.status(500).json({ error: 'Failed to complete ride' });
  }
});

// Cancel a ride
router.put('/:rideId/cancel', authenticateJWT, async (req, res) => {
  try {
    const { rideId } = req.params;
    const { reason } = req.body;

    const ride = await Ride.findById(rideId);
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    // Check if user is the driver or rider
    if (ride.driver.toString() !== req.user._id.toString() && 
        ride.rider.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (ride.status === 'completed' || ride.status === 'cancelled') {
      return res.status(400).json({ error: 'Ride cannot be cancelled' });
    }

    ride.status = 'cancelled';
    ride.cancellationReason = reason;
    ride.cancelledBy = ride.driver.toString() === req.user._id.toString() ? 'driver' : 'rider';
    await ride.save();

    await ride.populate(['rider', 'driver'], 'firstName lastName phone rating');

    res.json({
      message: 'Ride cancelled successfully',
      ride
    });

  } catch (error) {
    console.error('Cancel ride error:', error);
    res.status(500).json({ error: 'Failed to cancel ride' });
  }
});

// Rate a ride
router.post('/:rideId/rate', authenticateJWT, async (req, res) => {
  try {
    const { rideId } = req.params;
    const { rating, comment } = req.body;

    const ride = await Ride.findById(rideId);
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    // Check if user is the rider or driver
    const isRider = ride.rider.toString() === req.user._id.toString();
    const isDriver = ride.driver && ride.driver.toString() === req.user._id.toString();

    if (!isRider && !isDriver) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (ride.status !== 'completed') {
      return res.status(400).json({ error: 'Can only rate completed rides' });
    }

    // Update rating
    if (isRider) {
      ride.rating.riderRating = rating;
      ride.rating.riderComment = comment;
    } else if (isDriver) {
      ride.rating.driverRating = rating;
      ride.rating.driverComment = comment;
    }

    await ride.save();

    // Update user's average rating
    const userRides = await Ride.find({
      $or: [{ rider: req.user._id }, { driver: req.user._id }],
      status: 'completed'
    });

    const totalRating = userRides.reduce((sum, r) => {
      if (r.rider.toString() === req.user._id.toString()) {
        return sum + (r.rating.riderRating || 0);
      } else {
        return sum + (r.rating.driverRating || 0);
      }
    }, 0);

    const averageRating = userRides.length > 0 ? totalRating / userRides.length : 0;

    await User.findByIdAndUpdate(req.user._id, { rating: averageRating });

    res.json({
      message: 'Rating submitted successfully',
      ride
    });

  } catch (error) {
    console.error('Rate ride error:', error);
    res.status(500).json({ error: 'Failed to submit rating' });
  }
});

// Get user's ride history
router.get('/history', authenticateJWT, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;

    const query = {
      $or: [{ rider: req.user._id }, { driver: req.user._id }]
    };

    if (status) {
      query.status = status;
    }

    const rides = await Ride.find(query)
      .populate('rider', 'firstName lastName rating')
      .populate('driver', 'firstName lastName rating')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Ride.countDocuments(query);

    res.json({
      rides,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });

  } catch (error) {
    console.error('Get ride history error:', error);
    res.status(500).json({ error: 'Failed to get ride history' });
  }
});

// Get ride details
router.get('/:rideId', authenticateJWT, async (req, res) => {
  try {
    const { rideId } = req.params;

    const ride = await Ride.findById(rideId)
      .populate('rider', 'firstName lastName phone rating')
      .populate('driver', 'firstName lastName phone rating');

    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    // Check if user is authorized to view this ride
    if (ride.rider.toString() !== req.user._id.toString() && 
        (!ride.driver || ride.driver.toString() !== req.user._id.toString())) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    res.json({ ride });

  } catch (error) {
    console.error('Get ride details error:', error);
    res.status(500).json({ error: 'Failed to get ride details' });
  }
});

// Helper function to calculate distance between two points
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

module.exports = router;
