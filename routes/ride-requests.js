const express = require('express');
const router = express.Router();
const RideRequest = require('../models/RideRequest');
const User = require('../models/User');
const { authenticateJWT } = require('../middleware/auth');

// Create a new ride request
router.post('/create', authenticateJWT, async (req, res) => {
  try {
    const {
      pickupLocation,
      destination,
      requestedPrice,
      notes,
      vehicleType,
      paymentMethod,
      isUrgent
    } = req.body;

    // Validate required fields
    if (!pickupLocation || !destination) {
      return res.status(400).json({ error: 'Pickup and destination locations are required' });
    }

    // Check if user is a rider
    if (req.user.userType !== 'rider') {
      return res.status(403).json({ error: 'Only riders can create ride requests' });
    }

    // Create ride request
    const rideRequest = await RideRequest.createRequest({
      rider: req.user._id,
      pickupLocation,
      destination,
      requestedPrice: requestedPrice || null,
      notes,
      vehicleType,
      paymentMethod,
      isUrgent
    });

    // Find nearby drivers and add them to available drivers
    const nearbyDrivers = await rideRequest.findNearbyDrivers(rideRequest.requestRadius);
    
    for (const driver of nearbyDrivers) {
      const distance = rideRequest.calculateDistance(
        driver.location.coordinates[1], // latitude
        driver.location.coordinates[0], // longitude
        pickupLocation.latitude,
        pickupLocation.longitude
      );
      
      const estimatedTime = Math.round(distance * 2); // 2 minutes per km
      
      rideRequest.availableDrivers.push({
        driver: driver._id,
        distance,
        estimatedTime,
        viewedAt: new Date()
      });
    }

    await rideRequest.save();

    res.status(201).json({
      message: 'Ride request created successfully',
      rideRequest: {
        id: rideRequest._id,
        status: rideRequest.status,
        expiresAt: rideRequest.expiresAt,
        availableDrivers: rideRequest.availableDrivers.length,
        distance: rideRequest.distance,
        estimatedDuration: rideRequest.estimatedDuration,
        suggestedPrice: rideRequest.suggestedPrice,
        requestedPrice: rideRequest.requestedPrice
      }
    });

  } catch (error) {
    console.error('Error creating ride request:', error);
    res.status(500).json({ error: 'Failed to create ride request' });
  }
});

// New endpoint for ride request with 1.2km radius search
router.post('/request-ride', authenticateJWT, async (req, res) => {
  try {
    const {
      pickup,
      destination,
      offeredFare,
      radiusMeters = 1200, // Default 1.2km radius
      paymentMethod = 'cash',
      vehicleType = 'any',
      notes = ''
    } = req.body;

    // Validate required fields
    if (!pickup || !destination || !offeredFare) {
      return res.status(400).json({ 
        error: 'Pickup location, destination, and offered fare are required' 
      });
    }

    // Check if user is a rider
    if (req.user.userType !== 'rider') {
      return res.status(403).json({ error: 'Only riders can create ride requests' });
    }

    // Calculate distance and duration
    const distance = calculateHaversineDistance(
      pickup.latitude,
      pickup.longitude,
      destination.latitude,
      destination.longitude
    );

    const estimatedDuration = Math.round(distance * 2); // 2 minutes per km

    // Create ride request
    const rideRequest = new RideRequest({
      rider: req.user._id,
      pickupLocation: {
        latitude: pickup.latitude,
        longitude: pickup.longitude,
        address: pickup.address || 'Unknown location'
      },
      destination: {
        latitude: destination.latitude,
        longitude: destination.longitude,
        address: destination.address || 'Unknown destination'
      },
      distance,
      estimatedDuration,
      requestedPrice: offeredFare,
      suggestedPrice: offeredFare,
      notes,
      vehicleType,
      paymentMethod,
      requestRadius: radiusMeters / 1000, // Convert meters to km
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
      status: 'pending'
    });

    await rideRequest.save();

    // Find drivers within 1.2km radius using Haversine formula
    const nearbyDrivers = await findDriversWithinRadius(
      pickup.latitude,
      pickup.longitude,
      radiusMeters / 1000 // Convert to km
    );

    // Get socket.io instance
    const io = req.app.get('io');

    // Send ride request to each nearby driver via socket
    for (const driver of nearbyDrivers) {
      const driverSocketId = req.app.get('driverConnections')?.get(driver._id.toString());
      if (driverSocketId) {
        io.to(driverSocketId).emit('ride_request', {
          rideRequestId: rideRequest._id,
          rider: {
            id: req.user._id,
            firstName: req.user.firstName,
            lastName: req.user.lastName,
            rating: req.user.rating || 0
          },
          pickup: rideRequest.pickupLocation,
          destination: rideRequest.destination,
          distance: rideRequest.distance,
          estimatedDuration: rideRequest.estimatedDuration,
          offeredFare: rideRequest.requestedPrice,
          vehicleType: rideRequest.vehicleType,
          paymentMethod: rideRequest.paymentMethod,
          notes: rideRequest.notes,
          expiresAt: rideRequest.expiresAt,
          createdAt: rideRequest.createdAt
        });

        // Add driver to available drivers list
        rideRequest.availableDrivers.push({
          driver: driver._id,
          distance: calculateHaversineDistance(
            pickup.latitude,
            pickup.longitude,
            driver.currentLocation.coordinates[1],
            driver.currentLocation.coordinates[0]
          ),
          estimatedTime: Math.round(calculateHaversineDistance(
            pickup.latitude,
            pickup.longitude,
            driver.currentLocation.coordinates[1],
            driver.currentLocation.coordinates[0]
          ) * 2),
          viewedAt: new Date()
        });
      }
    }

    await rideRequest.save();

    res.status(201).json({
      message: 'Ride request sent to nearby drivers',
      rideRequest: {
        id: rideRequest._id,
        status: rideRequest.status,
        expiresAt: rideRequest.expiresAt,
        driversNotified: nearbyDrivers.length,
        distance: rideRequest.distance,
        estimatedDuration: rideRequest.estimatedDuration,
        offeredFare: rideRequest.requestedPrice
      }
    });

  } catch (error) {
    console.error('Error creating ride request:', error);
    res.status(500).json({ error: 'Failed to create ride request' });
  }
});

// Helper function to calculate Haversine distance
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Helper function to find drivers within radius
async function findDriversWithinRadius(latitude, longitude, radiusKm) {
  const User = require('../models/User');
  
  // Get all online drivers
  const drivers = await User.find({
    userType: 'driver',
    isOnline: true,
    isAvailable: true
  });

  // Filter drivers within radius using Haversine formula
  const nearbyDrivers = drivers.filter(driver => {
    if (!driver.currentLocation || !driver.currentLocation.coordinates) {
      return false;
    }
    
    const distance = calculateHaversineDistance(
      latitude,
      longitude,
      driver.currentLocation.coordinates[1], // latitude
      driver.currentLocation.coordinates[0]  // longitude
    );
    
    return distance <= radiusKm;
  });

  return nearbyDrivers;
}

// Get available ride requests for drivers
router.get('/available', authenticateJWT, async (req, res) => {
  try {
    // Check if user is a driver
    if (req.user.userType !== 'driver') {
      return res.status(403).json({ error: 'Only drivers can view available requests' });
    }

    const { latitude, longitude, radius = 5 } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Location coordinates are required' });
    }

    // Find pending ride requests within radius
    const rideRequests = await RideRequest.find({
      status: 'pending',
      expiresAt: { $gt: new Date() },
      'pickupLocation.latitude': {
        $gte: parseFloat(latitude) - (radius / 111), // Approximate degrees
        $lte: parseFloat(latitude) + (radius / 111)
      },
      'pickupLocation.longitude': {
        $gte: parseFloat(longitude) - (radius / (111 * Math.cos(parseFloat(latitude) * Math.PI / 180))),
        $lte: parseFloat(longitude) + (radius / (111 * Math.cos(parseFloat(latitude) * Math.PI / 180)))
      }
    })
    .populate('rider', 'firstName lastName rating totalRides')
    .sort({ createdAt: -1 })
    .limit(20);

    // Calculate exact distances and filter
    const filteredRequests = rideRequests.filter(request => {
      const distance = request.calculateDistance(
        parseFloat(latitude),
        parseFloat(longitude),
        request.pickupLocation.latitude,
        request.pickupLocation.longitude
      );
      return distance <= radius;
    });

    // Format response
    const formattedRequests = filteredRequests.map(request => {
      const distance = request.calculateDistance(
        parseFloat(latitude),
        parseFloat(longitude),
        request.pickupLocation.latitude,
        request.pickupLocation.longitude
      );
      
      const estimatedTime = Math.round(distance * 2); // 2 minutes per km

      return {
        id: request._id,
        rider: request.rider,
        pickupLocation: request.pickupLocation,
        destination: request.destination,
        distance: request.distance,
        estimatedDuration: request.estimatedDuration,
        requestedPrice: request.requestedPrice,
        suggestedPrice: request.suggestedPrice,
        notes: request.notes,
        vehicleType: request.vehicleType,
        paymentMethod: request.paymentMethod,
        isUrgent: request.isUrgent,
        createdAt: request.createdAt,
        expiresAt: request.expiresAt,
        driverDistance: distance,
        estimatedTime,
        timeRemaining: Math.max(0, Math.round((request.expiresAt - new Date()) / 1000 / 60)) // minutes
      };
    });

    res.json({
      requests: formattedRequests,
      total: formattedRequests.length
    });

  } catch (error) {
    console.error('Error fetching available requests:', error);
    res.status(500).json({ error: 'Failed to fetch available requests' });
  }
});

// Driver responds to a ride request
router.post('/:requestId/respond', authenticateJWT, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { action, counterOffer } = req.body; // action: 'accept', 'counter_offer', 'reject'

    // Check if user is a driver
    if (req.user.userType !== 'driver') {
      return res.status(403).json({ error: 'Only drivers can respond to requests' });
    }

    const rideRequest = await RideRequest.findById(requestId);
    if (!rideRequest) {
      return res.status(404).json({ error: 'Ride request not found' });
    }

    if (rideRequest.status !== 'pending') {
      return res.status(400).json({ error: 'Ride request is no longer available' });
    }

    if (rideRequest.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Ride request has expired' });
    }

    // Find driver in available drivers list
    const driverIndex = rideRequest.availableDrivers.findIndex(
      d => d.driver.toString() === req.user._id.toString()
    );

    if (driverIndex === -1) {
      return res.status(400).json({ error: 'Driver not in available drivers list' });
    }

    const driverResponse = rideRequest.availableDrivers[driverIndex];

    switch (action) {
      case 'accept':
        // Accept the ride request
        rideRequest.status = 'accepted';
        rideRequest.acceptedBy = req.user._id;
        driverResponse.status = 'accepted';
        driverResponse.respondedAt = new Date();
        
        // Notify rider (in real app, send push notification)
        await rideRequest.save();
        
        res.json({
          message: 'Ride request accepted successfully',
          rideRequest: {
            id: rideRequest._id,
            status: rideRequest.status,
            pickupLocation: rideRequest.pickupLocation,
            destination: rideRequest.destination,
            rider: rideRequest.rider
          }
        });
        break;

      case 'counter_offer':
        if (!counterOffer || counterOffer <= 0) {
          return res.status(400).json({ error: 'Valid counter offer is required' });
        }
        
        driverResponse.status = 'counter_offered';
        driverResponse.counterOffer = counterOffer;
        driverResponse.respondedAt = new Date();
        
        await rideRequest.save();
        
        res.json({
          message: 'Counter offer sent successfully',
          counterOffer
        });
        break;

      case 'reject':
        driverResponse.status = 'rejected';
        driverResponse.respondedAt = new Date();
        
        await rideRequest.save();
        
        res.json({
          message: 'Ride request rejected'
        });
        break;

      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

  } catch (error) {
    console.error('Error responding to ride request:', error);
    res.status(500).json({ error: 'Failed to respond to ride request' });
  }
});

// Rider accepts counter offer
router.post('/:requestId/accept-counter-offer', authenticateJWT, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { driverId } = req.body;

    // Check if user is a rider
    if (req.user.userType !== 'rider') {
      return res.status(403).json({ error: 'Only riders can accept counter offers' });
    }

    const rideRequest = await RideRequest.findById(requestId);
    if (!rideRequest) {
      return res.status(404).json({ error: 'Ride request not found' });
    }

    if (rideRequest.rider.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized to accept this counter offer' });
    }

    const driverResponse = rideRequest.availableDrivers.find(
      d => d.driver.toString() === driverId && d.status === 'counter_offered'
    );

    if (!driverResponse) {
      return res.status(404).json({ error: 'Counter offer not found' });
    }

    // Accept the counter offer
    rideRequest.status = 'accepted';
    rideRequest.acceptedBy = driverId;
    driverResponse.status = 'accepted';
    driverResponse.respondedAt = new Date();

    await rideRequest.save();

    res.json({
      message: 'Counter offer accepted successfully',
      rideRequest: {
        id: rideRequest._id,
        status: rideRequest.status,
        acceptedBy: rideRequest.acceptedBy,
        finalPrice: driverResponse.counterOffer
      }
    });

  } catch (error) {
    console.error('Error accepting counter offer:', error);
    res.status(500).json({ error: 'Failed to accept counter offer' });
  }
});

// Get ride request status (for riders)
router.get('/:requestId/status', authenticateJWT, async (req, res) => {
  try {
    const { requestId } = req.params;

    const rideRequest = await RideRequest.findById(requestId)
      .populate('rider', 'firstName lastName')
      .populate('acceptedBy', 'firstName lastName phone vehicle')
      .populate('availableDrivers.driver', 'firstName lastName rating vehicle');

    if (!rideRequest) {
      return res.status(404).json({ error: 'Ride request not found' });
    }

    if (rideRequest.rider._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized to view this request' });
    }

    res.json({
      rideRequest: {
        id: rideRequest._id,
        status: rideRequest.status,
        pickupLocation: rideRequest.pickupLocation,
        destination: rideRequest.destination,
        distance: rideRequest.distance,
        estimatedDuration: rideRequest.estimatedDuration,
        requestedPrice: rideRequest.requestedPrice,
        suggestedPrice: rideRequest.suggestedPrice,
        expiresAt: rideRequest.expiresAt,
        createdAt: rideRequest.createdAt,
        acceptedBy: rideRequest.acceptedBy,
        availableDrivers: rideRequest.availableDrivers,
        timeRemaining: Math.max(0, Math.round((rideRequest.expiresAt - new Date()) / 1000 / 60))
      }
    });

  } catch (error) {
    console.error('Error fetching ride request status:', error);
    res.status(500).json({ error: 'Failed to fetch ride request status' });
  }
});

// Cancel ride request
router.post('/:requestId/cancel', authenticateJWT, async (req, res) => {
  try {
    const { requestId } = req.params;

    const rideRequest = await RideRequest.findById(requestId);
    if (!rideRequest) {
      return res.status(404).json({ error: 'Ride request not found' });
    }

    if (rideRequest.rider.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized to cancel this request' });
    }

    if (rideRequest.status !== 'pending') {
      return res.status(400).json({ error: 'Cannot cancel non-pending request' });
    }

    rideRequest.status = 'cancelled';
    await rideRequest.save();

    res.json({
      message: 'Ride request cancelled successfully'
    });

  } catch (error) {
    console.error('Error cancelling ride request:', error);
    res.status(500).json({ error: 'Failed to cancel ride request' });
  }
});

module.exports = router;
