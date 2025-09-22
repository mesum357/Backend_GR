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
    console.log('🔧 Received request body:', req.body);
    const {
      pickup,
      destination,
      offeredFare,
      radiusMeters = 1200, // Default 1.2km radius
      paymentMethod = 'cash',
      vehicleType = 'any',
      notes = ''
    } = req.body;
    
    console.log('🔧 Payment method received:', paymentMethod);
    
    // Normalize payment method to lowercase
    const normalizedPaymentMethod = paymentMethod ? paymentMethod.toLowerCase() : 'cash';
    console.log('🔧 Normalized payment method:', normalizedPaymentMethod);

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

    // Cancel any existing searching/pending requests from this rider
    await RideRequest.updateMany(
      { 
        rider: req.user._id, 
        status: { $in: ['searching', 'pending'] }
      },
      { 
        status: 'cancelled',
        cancelledAt: new Date()
      }
    );
    console.log(`🚫 Cancelled previous searching/pending requests for rider ${req.user._id}`);

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
      paymentMethod: normalizedPaymentMethod,
      requestRadius: radiusMeters / 1000, // Convert meters to km
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
      status: 'searching'
    });

    await rideRequest.save();
    console.log('🔧 Ride request saved to database:', {
      id: rideRequest._id,
      status: rideRequest.status,
      expiresAt: rideRequest.expiresAt,
      createdAt: rideRequest.createdAt
    });

    // Find drivers within 1.2km radius using Haversine formula
    const nearbyDrivers = await findDriversWithinRadius(
      pickup.latitude,
      pickup.longitude,
      radiusMeters / 1000 // Convert to km
    );
    
    console.log('🔧 Found nearby drivers:', nearbyDrivers.length);

    // Get socket.io instance
    const io = req.app.get('io');

    // Send ride request to each nearby driver via socket
    let driversNotified = 0;
    console.log('🔧 [findDriversWithinRadius] Nearby drivers found:', nearbyDrivers.length);
    
    for (const driver of nearbyDrivers) {
      console.log('🔧 [findDriversWithinRadius] Processing driver:', {
        driverId: driver._id,
        userId: driver.user._id,
        userName: driver.user ? `${driver.user.firstName} ${driver.user.lastName}` : 'No user data',
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable,
        hasLocation: !!driver.currentLocation
      });
      
      const driverSocketId = req.app.get('driverConnections')?.get(driver.user._id.toString());
      console.log('🔧 [findDriversWithinRadius] Driver socket ID:', driverSocketId);
      
      if (driverSocketId) {
        console.log('🔧 Sending ride request to driver:', driver.user._id);
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
        driversNotified++;

        // Add driver to available drivers list
        rideRequest.availableDrivers.push({
          driver: driver.user._id,
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
      } else {
        console.log('🔧 Driver not connected via WebSocket:', driver.user._id);
        // Even if not connected via WebSocket, add to available drivers list
        rideRequest.availableDrivers.push({
          driver: driver.user._id,
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
    
    console.log('🔧 Total drivers notified:', driversNotified);

    await rideRequest.save();

    res.status(201).json({
      message: 'Ride request sent to nearby drivers',
      rideRequest: {
        id: rideRequest._id,
        status: rideRequest.status,
        expiresAt: rideRequest.expiresAt,
        driversNotified: driversNotified,
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
  const Driver = require('../models/Driver');
  
  console.log('🔍 [findDriversWithinRadius] Starting search...');
  console.log('🔍 [findDriversWithinRadius] Search params:', { latitude, longitude, radiusKm });
  
  // Get all online and available drivers from Driver model
  const drivers = await Driver.find({
    isOnline: true,
    isAvailable: true,
    isApproved: true
  }).populate('user', 'firstName lastName phone rating');

  console.log('🔍 [findDriversWithinRadius] Total drivers found in DB:', drivers.length);
  
  // Debug each driver's status
  drivers.forEach((driver, index) => {
    console.log(`🔍 [findDriversWithinRadius] Driver ${index + 1}:`, {
      id: driver._id,
      userId: driver.user?._id,
      isOnline: driver.isOnline,
      isAvailable: driver.isAvailable,
      isApproved: driver.isApproved,
      hasLocation: !!driver.currentLocation,
      coordinates: driver.currentLocation?.coordinates,
      userName: driver.user ? `${driver.user.firstName} ${driver.user.lastName}` : 'No user data'
    });
  });

  // Filter drivers within radius using Haversine formula
  const nearbyDrivers = drivers.filter(driver => {
    if (!driver.currentLocation || !driver.currentLocation.coordinates) {
      console.log('🔍 [findDriversWithinRadius] Driver has no location:', driver._id);
      return false;
    }
    
    const distance = calculateHaversineDistance(
      latitude,
      longitude,
      driver.currentLocation.coordinates[1], // latitude
      driver.currentLocation.coordinates[0]  // longitude
    );
    
    const isWithinRadius = distance <= radiusKm;
    console.log(`🔍 [findDriversWithinRadius] Driver ${driver._id} distance: ${distance.toFixed(2)}km, within radius: ${isWithinRadius}`);
    
    return isWithinRadius;
  });

  console.log('🔍 [findDriversWithinRadius] Final nearby drivers:', nearbyDrivers.length);
  return nearbyDrivers;
}

// Get ride request status
router.get('/:id/status', authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    
    const rideRequest = await RideRequest.findById(id);
    
    if (!rideRequest) {
      return res.status(404).json({ error: 'Ride request not found' });
    }
    
    // Check if user is the rider or a driver who can see this request
    if (rideRequest.rider.toString() !== req.user._id && 
        !rideRequest.availableDrivers.some(driver => driver.driver.toString() === req.user._id)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    res.json({
      id: rideRequest._id,
      status: rideRequest.status,
      acceptedBy: rideRequest.acceptedBy,
      requestedPrice: rideRequest.requestedPrice,
      expiresAt: rideRequest.expiresAt
    });
    
  } catch (error) {
    console.error('Error fetching ride request status:', error);
    res.status(500).json({ error: 'Failed to fetch ride request status' });
  }
});

// Driver respond to ride request
router.post('/:id/respond', authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, driverId, counterOffer } = req.body;
    
    const rideRequest = await RideRequest.findById(id);
    
    if (!rideRequest) {
      return res.status(404).json({ error: 'Ride request not found' });
    }
    
    // Check if user is a driver
    if (req.user.userType !== 'driver') {
      return res.status(403).json({ error: 'Only drivers can respond to ride requests' });
    }
    
    if (action === 'accept') {
      // Atomic assignment - only first accept wins
      if (rideRequest.status === 'pending') {
        rideRequest.status = 'accepted';
        rideRequest.acceptedBy = driverId;
        await rideRequest.save();
        
        res.json({ message: 'Ride request accepted successfully' });
      } else {
        res.status(400).json({ error: 'Ride request is no longer available' });
      }
    } else if (action === 'negotiate') {
      // Handle counter offer
      rideRequest.availableDrivers.forEach(availableDriver => {
        if (availableDriver.driver.toString() === driverId) {
          availableDriver.counterOffer = counterOffer;
          availableDriver.status = 'counter_offered';
          availableDriver.respondedAt = new Date();
        }
      });
      
      await rideRequest.save();
      res.json({ message: 'Counter offer sent successfully' });
    } else {
      res.status(400).json({ error: 'Invalid action' });
    }
    
  } catch (error) {
    console.error('Error responding to ride request:', error);
    res.status(500).json({ error: 'Failed to respond to ride request' });
  }
});

// Test endpoint to check all ride requests in database
router.get('/test-all', async (req, res) => {
  try {
    const allRequests = await RideRequest.find({})
      .populate('rider', 'firstName lastName rating totalRides')
      .sort({ createdAt: -1 });
    
    console.log('🔧 All ride requests in database:', allRequests.length);
    res.json({
      total: allRequests.length,
      requests: allRequests.map(req => ({
        id: req._id,
        status: req.status,
        rider: req.rider,
        requestedPrice: req.requestedPrice,
        pickupLocation: req.pickupLocation,
        destination: req.destination,
        distance: req.distance,
        estimatedDuration: req.estimatedDuration,
        paymentMethod: req.paymentMethod,
        notes: req.notes,
        createdAt: req.createdAt,
        expiresAt: req.expiresAt
      }))
    });
  } catch (error) {
    console.error('Error fetching all requests:', error);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// Get available ride requests for drivers
// Simple endpoint to get all available requests for drivers (without location filtering)
router.get('/available-simple', authenticateJWT, async (req, res) => {
  try {
    // Check if user is a driver (either by userType or has Driver profile)
    const Driver = require('../models/Driver');
    const driverProfile = await Driver.findOne({ user: req.user._id });
    
    if (req.user.userType !== 'driver' && !driverProfile) {
      return res.status(403).json({ error: 'Only drivers can view available requests' });
    }

    // Ensure driver is online and available
    if (driverProfile && (!driverProfile.isOnline || !driverProfile.isAvailable)) {
      console.log('🔧 Driver is not online or available:', {
        isOnline: driverProfile.isOnline,
        isAvailable: driverProfile.isAvailable
      });
      return res.json([]);
    }

    // Find all available ride requests that haven't expired
    const currentTime = new Date();
    console.log('🔧 Current time:', currentTime.toISOString());
    
    const rideRequests = await RideRequest.find({
      status: { $in: ['searching', 'pending'] },
      expiresAt: { $gt: currentTime }
    })
    .populate('rider', 'firstName lastName rating totalRides')
    .sort({ createdAt: -1 })
    .limit(20);

    console.log('🔧 Found ride requests:', rideRequests.length);
    console.log('🔧 Driver userType:', req.user.userType);
    console.log('🔧 Driver profile exists:', !!driverProfile);
    console.log('🔧 Driver isOnline:', driverProfile?.isOnline);
    console.log('🔧 Driver isAvailable:', driverProfile?.isAvailable);
    
    // Debug: Check all ride requests in database
    const allRequests = await RideRequest.find({}).sort({ createdAt: -1 }).limit(5);
    console.log('🔧 All recent ride requests in DB:', allRequests.length);
    allRequests.forEach(req => {
      console.log(`🔧 DB Request ${req._id}: status=${req.status}, expiresAt=${req.expiresAt}, createdAt=${req.createdAt}`);
    });
    
    rideRequests.forEach(request => {
      console.log(`🔧 Request ${request._id}: PKR ${request.requestedPrice} (suggested: ${request.suggestedPrice}) - Status: ${request.status}`);
    });

    // Format response to match frontend interface
    const formattedRequests = rideRequests.map(request => {
      const rider = request.rider;
      const pickupLocation = request.pickupLocation;
      const destination = request.destination;
      
      // Normalize distance values (schema uses Number, legacy could be String)
      const numericDistance = typeof request.distance === 'number'
        ? request.distance
        : (typeof request.distance === 'string'
            ? parseFloat((request.distance || '0').toString().replace(' km', ''))
            : 0);

      const distanceLabel = Number.isFinite(numericDistance)
        ? `${numericDistance.toFixed(1)} km`
        : '0 km';

      return {
        _id: request._id,
        id: request._id,
        pickupLocation: pickupLocation?.address || 'Unknown location',
        pickupLocationDetails: {
          address: pickupLocation?.address || 'Unknown location',
          coordinates: [pickupLocation?.longitude || 0, pickupLocation?.latitude || 0]
        },
        destinationDetails: {
          address: destination?.address || 'Unknown destination',
          coordinates: [destination?.longitude || 0, destination?.latitude || 0]
        },
        dropoffLocation: destination?.address || 'Unknown destination',
        distance: distanceLabel,
        estimatedFare: request.suggestedPrice || request.requestedPrice || 0,
        requestedPrice: request.requestedPrice || 0,
        estimatedDuration: request.estimatedDuration || 0,
        estimatedDistance: Number.isFinite(numericDistance) ? numericDistance : 0,
        riderName: rider ? `${rider.firstName} ${rider.lastName}` : 'Unknown Rider',
        riderPhone: rider?.phone || 'N/A',
        riderRating: rider?.rating || 4.5,
        estimatedTime: request.estimatedDuration ? `${request.estimatedDuration} min` : 'Unknown',
        requestTime: request.createdAt ? new Date(request.createdAt).toLocaleTimeString() : 'Unknown',
        paymentMethod: request.paymentMethod || 'cash',
        specialRequests: request.notes,
        riderOffer: request.requestedPrice,
        vehicleType: request.vehicleType,
        autoAccept: false,
        status: request.status,
        createdAt: request.createdAt
      };
    });

    res.json({
      rideRequests: formattedRequests,
      total: formattedRequests.length
    });

  } catch (error) {
    console.error('Error fetching available requests:', error);
    res.status(500).json({ error: 'Failed to fetch available requests' });
  }
});

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

    if (!['searching', 'pending'].includes(rideRequest.status)) {
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
        
        await rideRequest.save();
        
        // Emit WebSocket event to notify rider
        const io = req.app.get('io');
        if (io) {
          const activeConnections = req.app.get('activeConnections');
          const riderSocketId = activeConnections.get(rideRequest.rider.toString());
          if (riderSocketId) {
            io.to(riderSocketId).emit('driver_assigned', {
              rideRequestId: rideRequest._id,
              driverId: req.user._id,
              message: 'Driver has been assigned to your ride'
            });
            console.log(`🚗 Notified rider ${rideRequest.rider} about driver assignment`);
          }
          
          // Notify all drivers that this request is no longer available
          const driverConnections = req.app.get('driverConnections');
          
          driverConnections.forEach((socketId, driverId) => {
            io.to(socketId).emit('ride_request_status_update', {
              rideRequestId: rideRequest._id,
              oldStatus: 'searching',
              newStatus: 'accepted',
              message: 'Ride request has been accepted by a driver'
            });
          });
          
          console.log(`📡 Notified all drivers about ride request ${rideRequest._id} acceptance`);
        }
        
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

    if (!['searching', 'pending'].includes(rideRequest.status)) {
      return res.status(400).json({ error: 'Cannot cancel non-active request' });
    }

    const oldStatus = rideRequest.status;
    rideRequest.status = 'cancelled';
    rideRequest.cancelledAt = new Date();
    await rideRequest.save();

    console.log(`🚫 Ride request ${requestId} cancelled by rider ${req.user._id} - Status changed from ${oldStatus} to cancelled`);
    
    // Emit WebSocket event to notify all drivers about the cancellation
    const io = req.app.get('io');
    if (io) {
      // Get all connected drivers
      const driverConnections = req.app.get('driverConnections');
      
      console.log(`🔍 Driver connections available: ${driverConnections ? driverConnections.size : 0}`);
      
      if (driverConnections && driverConnections.size > 0) {
        // Emit to all connected drivers
        driverConnections.forEach((socketId, driverId) => {
          try {
            const cancellationData = {
              rideRequestId: requestId,
              riderId: req.user._id,
              message: 'Ride request has been cancelled by the rider',
              oldStatus,
              newStatus: 'cancelled',
              timestamp: new Date().toISOString()
            };
            
            io.to(socketId).emit('ride_request_cancelled', cancellationData);
            console.log(`📡 WebSocket notification sent to driver ${driverId} (${socketId}): Ride request ${requestId} cancelled`);
            console.log(`📡 Cancellation data:`, cancellationData);
          } catch (wsError) {
            console.error(`❌ Failed to send WebSocket notification to driver ${driverId}:`, wsError);
          }
        });
        
        console.log(`📡 WebSocket notification sent to ${driverConnections.size} drivers: Ride request ${requestId} cancelled`);
      } else {
        console.log('⚠️ No connected drivers to notify about cancellation');
      }
    } else {
      console.error('❌ WebSocket server not available for cancellation notification');
    }
    
    // Verify the status was actually saved
    const verifyRequest = await RideRequest.findById(requestId);
    console.log(`🔍 Verification - Ride request ${requestId} status after save: ${verifyRequest.status}`);

    res.json({
      message: 'Ride request cancelled successfully',
      oldStatus,
      newStatus: 'cancelled'
    });

  } catch (error) {
    console.error('Error cancelling ride request:', error);
    res.status(500).json({ error: 'Failed to cancel ride request' });
  }
});

// Debug endpoint to check ride request status
router.get('/:requestId/debug', authenticateJWT, async (req, res) => {
  try {
    const { requestId } = req.params;
    const rideRequest = await RideRequest.findById(requestId);
    
    if (!rideRequest) {
      return res.status(404).json({ error: 'Ride request not found' });
    }
    
    res.json({
      id: rideRequest._id,
      status: rideRequest.status,
      rider: rideRequest.rider,
      createdAt: rideRequest.createdAt,
      cancelledAt: rideRequest.cancelledAt
    });
  } catch (error) {
    console.error('Error fetching ride request debug info:', error);
    res.status(500).json({ error: 'Failed to fetch ride request debug info' });
  }
});

// Test endpoint to create sample ride requests (for development only)
router.post('/create-test-request', authenticateJWT, async (req, res) => {
  try {
    // Only allow in development
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Test endpoint not available in production' });
    }

    // Check if user is a rider
    if (req.user.userType !== 'rider') {
      return res.status(403).json({ error: 'Only riders can create test requests' });
    }

    // Create a test ride request
    const testRequest = new RideRequest({
      rider: req.user._id,
      pickupLocation: {
        latitude: 35.9208,
        longitude: 74.3144,
        address: 'Gilgit City Center'
      },
      destination: {
        latitude: 35.9308,
        longitude: 74.3244,
        address: 'Gilgit Airport'
      },
      distance: 1.2,
      estimatedDuration: 5,
      requestedPrice: 150,
      suggestedPrice: 150,
      notes: 'Test ride request',
      vehicleType: 'car',
      paymentMethod: 'cash',
      requestRadius: 5,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
      status: 'searching'
    });

    await testRequest.save();
    console.log('🔧 Test ride request created:', {
      id: testRequest._id,
      status: testRequest.status,
      expiresAt: testRequest.expiresAt
    });

    res.status(201).json({
      message: 'Test ride request created successfully',
      rideRequest: {
        id: testRequest._id,
        status: testRequest.status,
        expiresAt: testRequest.expiresAt
      }
    });

  } catch (error) {
    console.error('Error creating test ride request:', error);
    res.status(500).json({ error: 'Failed to create test ride request' });
  }
});

// Test endpoint to check available ride requests (for development only)
router.get('/test-available', authenticateJWT, async (req, res) => {
  try {
    // Only allow in development
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Test endpoint not available in production' });
    }

    // Check if user is a driver
    if (req.user.userType !== 'driver') {
      return res.status(403).json({ error: 'Only drivers can test available requests' });
    }

    const currentTime = new Date();
    console.log('🔧 Test - Current time:', currentTime.toISOString());
    
    // Find all ride requests
    const allRequests = await RideRequest.find({}).sort({ createdAt: -1 }).limit(10);
    console.log('🔧 Test - All ride requests:', allRequests.length);
    
    // Find available ride requests
    const availableRequests = await RideRequest.find({
      status: { $in: ['searching', 'pending'] },
      expiresAt: { $gt: currentTime }
    }).sort({ createdAt: -1 }).limit(10);
    
    console.log('🔧 Test - Available ride requests:', availableRequests.length);
    
    res.json({
      message: 'Test results',
      currentTime: currentTime.toISOString(),
      allRequests: allRequests.map(req => ({
        id: req._id,
        status: req.status,
        expiresAt: req.expiresAt,
        createdAt: req.createdAt
      })),
      availableRequests: availableRequests.map(req => ({
        id: req._id,
        status: req.status,
        expiresAt: req.expiresAt,
        createdAt: req.createdAt
      }))
    });

  } catch (error) {
    console.error('Error testing available requests:', error);
    res.status(500).json({ error: 'Failed to test available requests' });
  }
});

// Debug endpoint to check driver status
router.get('/debug-drivers', authenticateJWT, async (req, res) => {
  try {
    // Only allow in development
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Debug endpoint not available in production' });
    }

    const Driver = require('../models/Driver');
    
    // Get all drivers
    const allDrivers = await Driver.find({}).populate('user', 'firstName lastName email');
    
    // Get online drivers
    const onlineDrivers = await Driver.find({
      isOnline: true
    }).populate('user', 'firstName lastName email');
    
    // Get available drivers
    const availableDrivers = await Driver.find({
      isOnline: true,
      isAvailable: true
    }).populate('user', 'firstName lastName email');
    
    // Get approved drivers
    const approvedDrivers = await Driver.find({
      isApproved: true
    }).populate('user', 'firstName lastName email');
    
    // Get drivers with location
    const driversWithLocation = await Driver.find({
      currentLocation: { $exists: true, $ne: null }
    }).populate('user', 'firstName lastName email');
    
    res.json({
      message: 'Driver debug information',
      totalDrivers: allDrivers.length,
      onlineDrivers: onlineDrivers.length,
      availableDrivers: availableDrivers.length,
      approvedDrivers: approvedDrivers.length,
      driversWithLocation: driversWithLocation.length,
      allDrivers: allDrivers.map(driver => ({
        id: driver._id,
        userId: driver.user?._id,
        userName: driver.user ? `${driver.user.firstName} ${driver.user.lastName}` : 'No user',
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable,
        isApproved: driver.isApproved,
        isVerified: driver.isVerified,
        hasLocation: !!driver.currentLocation,
        coordinates: driver.currentLocation?.coordinates,
        lastActive: driver.lastActive
      }))
    });

  } catch (error) {
    console.error('Error debugging drivers:', error);
    res.status(500).json({ error: 'Failed to debug drivers' });
  }
});

// Debug endpoint to get all ride requests
router.get('/debug-all-requests', authenticateJWT, async (req, res) => {
  try {
    // Only allow in development
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Debug endpoint not available in production' });
    }

    const allRequests = await RideRequest.find({}).populate('rider', 'firstName lastName email phone').sort({ createdAt: -1 });
    
    res.json({
      message: 'All ride requests debug information',
      totalRequests: allRequests.length,
      requests: allRequests.map(request => ({
        id: request._id,
        status: request.status,
        pickupLocation: request.pickupLocation,
        destination: request.destination,
        fare: request.requestedPrice,
        createdAt: request.createdAt,
        riderName: request.rider ? `${request.rider.firstName} ${request.rider.lastName}` : 'No rider data',
        riderEmail: request.rider?.email,
        riderPhone: request.rider?.phone,
        driversNotified: request.availableDrivers?.length || 0,
        availableDrivers: request.availableDrivers?.map(ad => ({
          driver: ad.driver,
          distance: ad.distance,
          estimatedTime: ad.estimatedTime,
          viewedAt: ad.viewedAt
        })) || []
      }))
    });
  } catch (error) {
    console.error('Error getting debug ride requests info:', error);
    res.status(500).json({ error: 'Failed to get debug ride requests info' });
  }
});

// Debug endpoint to test findDriversWithinRadius function
router.get('/debug-find-drivers', authenticateJWT, async (req, res) => {
  try {
    // Only allow in development
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Debug endpoint not available in production' });
    }

    const { latitude = 35.911263, longitude = 74.3501778, radius = 5 } = req.query;
    
    console.log('🔍 [debug-find-drivers] Testing with params:', { latitude, longitude, radius });
    
    const nearbyDrivers = await findDriversWithinRadius(parseFloat(latitude), parseFloat(longitude), parseFloat(radius));
    
    res.json({
      message: 'findDriversWithinRadius debug information',
      searchParams: {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        radius: parseFloat(radius)
      },
      nearbyDrivers: nearbyDrivers.map(driver => ({
        id: driver._id,
        userId: driver.user?._id,
        userName: driver.user ? `${driver.user.firstName} ${driver.user.lastName}` : 'No user data',
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable,
        isApproved: driver.isApproved,
        hasLocation: !!driver.currentLocation,
        coordinates: driver.currentLocation?.coordinates,
        distance: driver.currentLocation ? calculateHaversineDistance(
          parseFloat(latitude),
          parseFloat(longitude),
          driver.currentLocation.coordinates[1],
          driver.currentLocation.coordinates[0]
        ) : null
      }))
    });
  } catch (error) {
    console.error('Error testing findDriversWithinRadius:', error);
    res.status(500).json({ error: 'Failed to test findDriversWithinRadius' });
  }
});

module.exports = router;
