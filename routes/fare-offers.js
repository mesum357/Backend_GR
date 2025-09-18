const express = require('express');
const router = express.Router();
const RideRequest = require('../models/RideRequest');
const User = require('../models/User');
const { authenticateJWT } = require('../middleware/auth');

// Driver makes a fare offer
router.post('/offer', authenticateJWT, async (req, res) => {
  try {
    const { rideRequestId, fareAmount, arrivalTime } = req.body;
    const driverId = req.user._id;

    // Check if user is a driver
    if (req.user.userType !== 'driver') {
      return res.status(403).json({ error: 'Only drivers can make fare offers' });
    }

    // Find the ride request
    const rideRequest = await RideRequest.findById(rideRequestId);
    if (!rideRequest) {
      return res.status(404).json({ error: 'Ride request not found' });
    }

    // Check if ride request is still active
    if (rideRequest.status !== 'searching') {
      return res.status(400).json({ error: 'Ride request is no longer active' });
    }

    // Get driver details
    const driver = await User.findById(driverId);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    // Create fare offer
    const fareOffer = {
      driver: driverId,
      driverName: `${driver.firstName} ${driver.lastName}`,
      driverRating: driver.rating || 4.5,
      fareAmount,
      arrivalTime,
      vehicleInfo: driver.vehicleInfo || 'Standard Vehicle',
      offeredAt: new Date(),
      status: 'pending' // pending, accepted, rejected
    };

    // Add fare offer to ride request
    if (!rideRequest.fareOffers) {
      rideRequest.fareOffers = [];
    }
    
    // Remove any existing offer from this driver
    rideRequest.fareOffers = rideRequest.fareOffers.filter(
      offer => offer.driver.toString() !== driverId.toString()
    );
    
    // Add new offer
    rideRequest.fareOffers.push(fareOffer);
    await rideRequest.save();

    console.log(`💰 Driver ${driverId} offered PKR ${fareAmount} for ride ${rideRequestId}`);

    res.json({
      message: 'Fare offer submitted successfully',
      fareOffer: {
        id: fareOffer._id,
        driverName: fareOffer.driverName,
        driverRating: fareOffer.driverRating,
        fareAmount: fareOffer.fareAmount,
        arrivalTime: fareOffer.arrivalTime,
        vehicleInfo: fareOffer.vehicleInfo
      }
    });

  } catch (error) {
    console.error('Error creating fare offer:', error);
    res.status(500).json({ error: 'Failed to create fare offer' });
  }
});

// Rider responds to fare offer
router.post('/:offerId/respond', authenticateJWT, async (req, res) => {
  try {
    const { offerId } = req.params;
    const { action } = req.body; // 'accept' or 'reject'
    const riderId = req.user._id;

    // Check if user is a rider
    if (req.user.userType !== 'rider') {
      return res.status(403).json({ error: 'Only riders can respond to fare offers' });
    }

    // Find ride request with the fare offer
    const rideRequest = await RideRequest.findOne({
      'fareOffers._id': offerId,
      rider: riderId
    });

    if (!rideRequest) {
      return res.status(404).json({ error: 'Fare offer not found' });
    }

    // Find the specific offer
    const offer = rideRequest.fareOffers.find(o => o._id.toString() === offerId);
    if (!offer) {
      return res.status(404).json({ error: 'Fare offer not found' });
    }

    if (offer.status !== 'pending') {
      return res.status(400).json({ error: 'Fare offer has already been responded to' });
    }

    // Update offer status
    offer.status = action;
    offer.respondedAt = new Date();

    if (action === 'accept') {
      // Update ride request status
      rideRequest.status = 'accepted';
      rideRequest.acceptedBy = offer.driver;
      rideRequest.acceptedAt = new Date();
      
      // Cancel all other pending offers
      rideRequest.fareOffers.forEach(o => {
        if (o._id.toString() !== offerId && o.status === 'pending') {
          o.status = 'rejected';
          o.respondedAt = new Date();
        }
      });
    }

    await rideRequest.save();

    console.log(`💰 Rider ${riderId} ${action}ed fare offer ${offerId}`);

    res.json({
      message: `Fare offer ${action}ed successfully`,
      rideRequest: {
        id: rideRequest._id,
        status: rideRequest.status,
        acceptedBy: rideRequest.acceptedBy
      }
    });

  } catch (error) {
    console.error('Error responding to fare offer:', error);
    res.status(500).json({ error: 'Failed to respond to fare offer' });
  }
});

// Get fare offers for a ride request (for riders)
router.get('/ride/:rideRequestId', authenticateJWT, async (req, res) => {
  try {
    const { rideRequestId } = req.params;
    const riderId = req.user._id;

    // Check if user is a rider
    if (req.user.userType !== 'rider') {
      return res.status(403).json({ error: 'Only riders can view fare offers' });
    }

    // Find the ride request
    const rideRequest = await RideRequest.findOne({
      _id: rideRequestId,
      rider: riderId
    });

    if (!rideRequest) {
      return res.status(404).json({ error: 'Ride request not found' });
    }

    res.json({
      fareOffers: rideRequest.fareOffers || []
    });

  } catch (error) {
    console.error('Error fetching fare offers:', error);
    res.status(500).json({ error: 'Failed to fetch fare offers' });
  }
});

module.exports = router;
