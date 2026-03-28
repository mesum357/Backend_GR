const express = require('express');
const Ride = require('../models/Ride');
const User = require('../models/User');
const { authenticateJWT, requireUserType } = require('../middleware/auth');
const router = express.Router();
const RideRequest = require('../models/RideRequest');

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
    let { rating, comment } = req.body || {};
    if ((rating === undefined || rating === null || rating === '') && req.body) {
      rating = req.body.stars ?? req.body.score ?? req.body.starRating;
    }
    let numericRating;
    if (typeof rating === 'number' && Number.isFinite(rating)) {
      numericRating = rating;
    } else if (typeof rating === 'string' && rating.trim() !== '') {
      numericRating = parseFloat(rating.trim());
    } else {
      numericRating = Number(rating);
    }
    if (!Number.isFinite(numericRating)) {
      return res.status(400).json({ error: 'Rating must be a number' });
    }
    if (numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    let ride = await Ride.findById(rideId);
    // Fallback: if ride not found by ID, but there is a RideRequest with this ID,
    // create a minimal Ride document so the rating flow never breaks.
    if (!ride) {
      const rideRequest = await RideRequest.findById(rideId);
      if (rideRequest) {
        const pickup = {
          address: rideRequest.pickupLocation?.address || '',
          location: {
            type: 'Point',
            coordinates: [
              rideRequest.pickupLocation?.longitude || 0,
              rideRequest.pickupLocation?.latitude || 0,
            ],
          },
        };
        const destination = {
          address: rideRequest.destination?.address || rideRequest.destinationLocation?.address || '',
          location: {
            type: 'Point',
            coordinates: [
              rideRequest.destination?.longitude || rideRequest.destinationLocation?.longitude || 0,
              rideRequest.destination?.latitude || rideRequest.destinationLocation?.latitude || 0,
            ],
          },
        };

        const distanceKm = rideRequest.distance || 0;
        const durationMin = rideRequest.estimatedDuration || 0;
        const amount = rideRequest.requestedPrice || rideRequest.suggestedPrice || 0;

        ride = new Ride({
          _id: rideRequest._id,
          rider: rideRequest.rider,
          driver: rideRequest.acceptedBy || null,
          pickup,
          destination,
          distance: distanceKm,
          duration: durationMin,
          price: {
            amount,
            currency: 'PKR',
            negotiated: true,
          },
          paymentMethod: rideRequest.paymentMethod || 'cash',
          status: 'completed',
          startTime: rideRequest.startedAt || new Date(),
          endTime: rideRequest.completedAt || new Date(),
        });
        await ride.save();
      }
    }
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    // Check if user is the rider or driver
    const isRider = ride.rider && ride.rider.toString() === req.user._id.toString();
    const isDriver = ride.driver && ride.driver.toString() === req.user._id.toString();

    if (!isRider && !isDriver) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (ride.status !== 'completed') {
      return res.status(400).json({ error: 'Can only rate completed rides' });
    }

    // The user submitting the review rates the OTHER party:
    // - Rider submits → rates driver (driverRating/driverComment)
    // - Driver submits → rates rider (riderRating/riderComment)
    let ratedUserId = null;
    const trimmedComment =
      typeof comment === 'string' && comment.trim().length > 0 ? comment.trim() : null;

    if (isRider) {
      if (!ride.driver) return res.status(400).json({ error: 'Driver missing for this ride' });
      ride.rating.driverRating = numericRating;
      ride.rating.driverComment = trimmedComment;
      ratedUserId = ride.driver.toString();
    } else if (isDriver) {
      ride.rating.riderRating = numericRating;
      ride.rating.riderComment = trimmedComment;
      ratedUserId = ride.rider.toString();
    }

    await ride.save();

    // Update the RATED user's average rating based on completed rides.
    // Only include rides that already have a numeric rating.
    const ratedUserRides = await Ride.find({
      $or: [{ rider: ratedUserId }, { driver: ratedUserId }],
      status: 'completed'
    });

    let sum = 0;
    let count = 0;

    for (const r of ratedUserRides) {
      if (!r.rating) continue;
      if (r.rider && r.rider.toString() === ratedUserId?.toString()) {
        const val = r.rating.riderRating;
        if (typeof val === 'number' && val >= 1 && val <= 5) {
          sum += val;
          count += 1;
        }
      } else {
        const val = r.rating.driverRating;
        if (typeof val === 'number' && val >= 1 && val <= 5) {
          sum += val;
          count += 1;
        }
      }
    }

    const averageRating = count > 0 ? sum / count : 0;

    if (ratedUserId) {
      await User.findByIdAndUpdate(ratedUserId, { rating: averageRating });
    }

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
