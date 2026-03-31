const express = require('express');
const router = express.Router();
const REQUEST_EXPIRY_MS = 72 * 1000; // 1.2 minutes
const RideRequest = require('../models/RideRequest');
const User = require('../models/User');
const Driver = require('../models/Driver');
const { authenticateJWT } = require('../middleware/auth');

/** Same delivery semantics as server.js emitToUser (user room + legacy socket id). */
function emitToUserFromApp(req, userId, event, payload) {
  const io = req.app.get('io');
  if (!io) return;
  const uid = userId != null ? String(userId) : '';
  if (!uid) return;
  const activeConnections = req.app.get('activeConnections');
  const driverConnections = req.app.get('driverConnections');
  io.to(`user:${uid}`).emit(event, payload);
  const sid = activeConnections?.get(uid) || driverConnections?.get(uid);
  if (sid) io.to(sid).emit(event, payload);
}

function collectRelevantDriverIds(rideRequest) {
  const ids = new Set();
  if (rideRequest.acceptedBy) ids.add(String(rideRequest.acceptedBy));
  if (Array.isArray(rideRequest.availableDrivers)) {
    rideRequest.availableDrivers.forEach((e) => {
      if (e?.driver) ids.add(String(e.driver));
    });
  }
  if (Array.isArray(rideRequest.fareOffers)) {
    rideRequest.fareOffers.forEach((o) => {
      if (o?.driver) ids.add(String(o.driver));
    });
  }
  return [...ids];
}

/**
 * Push cancellation to all parties that should react in real time.
 * @param {string} cancelledByUserId - user who cancelled; rider is not echoed ride_cancelled (they already know from HTTP / local UI).
 */
function notifyRideCancellationRealtime(req, rideRequest, requestId, cancelledByUserId) {
  const rid = String(requestId);
  const riderId = String(rideRequest.rider);
  const canceller = String(cancelledByUserId);
  const payload = { rideRequestId: rid };
  const payloadDetailed = {
    rideRequestId: rid,
    message: 'Ride request has been cancelled',
    newStatus: 'cancelled',
    timestamp: new Date().toISOString(),
  };

  const driverIds = collectRelevantDriverIds(rideRequest);
  driverIds.forEach((driverId) => {
    if (String(driverId) === String(cancelledByUserId)) return;
    emitToUserFromApp(req, driverId, 'ride_request_cancelled', payloadDetailed);
    emitToUserFromApp(req, driverId, 'ride_cancelled', payload);
  });

  // If the driver cancelled, tell the rider so tracking / overlays close.
  if (canceller !== riderId) {
    emitToUserFromApp(req, riderId, 'ride_request_cancelled', payloadDetailed);
    emitToUserFromApp(req, riderId, 'ride_cancelled', payload);
  }
}

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
        estimatedTime
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
    res.status(500).json({
      error: 'Failed to create ride request',
      message: error instanceof Error ? error.message : String(error),
    });
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
      expiresAt: new Date(Date.now() + REQUEST_EXPIRY_MS), // 1.2 minutes
      status: 'searching'
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

    // Always add the driver to `availableDrivers` so they can accept even if
    // their websocket is not currently connected.
    //
    // IMPORTANT race-condition fix:
    // We must save `availableDrivers` *before* emitting `ride_request`,
    // otherwise a fast driver might call `/respond` before the DB update lands.
    let driversNotified = 0;
    const targetDriverUserIds = new Set();
    for (const driver of nearbyDrivers) {
      // `driver.user` comes from `Driver.findNearbyDrivers()` which may be populated.
      // `RideRequest.availableDrivers.driver` expects a `User` ObjectId, so we must
      // always store `driver.user._id` (not the whole populated document).
      const populatedUser = driver.user;
      // `driver.user` might be populated (full User doc) or plain ObjectId.
      // `availableDrivers.driver` expects a User ObjectId string.
      const driverUserId = populatedUser && populatedUser._id
        ? populatedUser._id.toString()
        : (populatedUser ? populatedUser.toString() : null);
      if (!driverUserId) {
        console.warn('Skipping driver with missing user id', {
          driverId: driver?._id?.toString?.(),
          hasUser: !!driver?.user,
        });
        continue;
      }
      const driverSocketId = req.app.get('driverConnections')?.get(driverUserId);

      rideRequest.availableDrivers.push({
        driver: driverUserId,
        distance: calculateHaversineDistance(
          pickup.latitude,
          pickup.longitude,
          (driver.currentLocation || driver.location).coordinates[1],
          (driver.currentLocation || driver.location).coordinates[0]
        ),
        estimatedTime: Math.round(calculateHaversineDistance(
          pickup.latitude,
          pickup.longitude,
          (driver.currentLocation || driver.location).coordinates[1],
          (driver.currentLocation || driver.location).coordinates[0]
        ) * 2)
      });

      targetDriverUserIds.add(driverUserId);
      if (driverSocketId) driversNotified += 1;
    }

    await rideRequest.save();

    const rideRequestPayload = {
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
    };

    // Emit after DB save to ensure `/respond` can find the driver in availableDrivers.
    // Use room+legacy delivery semantics for reliability across reconnects/multiple sockets.
    targetDriverUserIds.forEach((driverUserId) => {
      emitToUserFromApp(req, driverUserId, 'ride_request', rideRequestPayload);
    });

    res.status(201).json({
      message: 'Ride request sent to nearby drivers',
      rideRequest: {
        id: rideRequest._id,
        status: rideRequest.status,
        expiresAt: rideRequest.expiresAt,
        driversNotified,
        driversFound: nearbyDrivers.length > 0,
        distance: rideRequest.distance,
        estimatedDuration: rideRequest.estimatedDuration,
        offeredFare: rideRequest.requestedPrice
      }
    });

  } catch (error) {
    console.error('Error creating ride request:', error);
    res.status(500).json({
      error: 'Failed to create ride request',
      message: error instanceof Error ? error.message : String(error),
    });
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

async function findDriversWithinRadius(latitude, longitude, radiusKm) {
  try {
    // Use the Driver model's static method for geospatial search
    const nearbyDrivers = await Driver.findNearbyDrivers(latitude, longitude, radiusKm);
    console.log(`🔍 Found ${nearbyDrivers.length} nearby drivers within ${radiusKm}km`);
    return nearbyDrivers;
  } catch (error) {
    console.error('❌ Error finding nearby drivers:', error);
    return [];
  }
}

// Get ride request status (rider, assigned driver, or drivers who were offered the request)
router.get('/:id/status', authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const uid = String(req.user._id);

    const rideRequest = await RideRequest.findById(id);

    if (!rideRequest) {
      return res.status(404).json({ error: 'Ride request not found' });
    }

    const isRider = rideRequest.rider.toString() === uid;
    const isAssignedDriver =
      rideRequest.acceptedBy && rideRequest.acceptedBy.toString() === uid;
    const isAvailableDriver = (rideRequest.availableDrivers || []).some(
      (entry) => entry.driver && entry.driver.toString() === uid
    );

    if (!isRider && !isAssignedDriver && !isAvailableDriver) {
      return res.status(403).json({ error: 'Access denied' });
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
        riderArrivedAt: rideRequest.riderArrivedAt,
        availableDrivers: rideRequest.availableDrivers,
      },
      id: rideRequest._id,
      status: rideRequest.status,
      acceptedBy: rideRequest.acceptedBy,
      riderArrivedAt: rideRequest.riderArrivedAt,
      requestedPrice: rideRequest.requestedPrice,
      expiresAt: rideRequest.expiresAt,
    });
  } catch (error) {
    console.error('Error fetching ride request status:', error);
    res.status(500).json({ error: 'Failed to fetch ride request status' });
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
    // Check if user is a driver
    if (req.user.userType !== 'driver') {
      return res.status(403).json({ error: 'Only drivers can view available requests' });
    }

    // Find all available ride requests that haven't expired
    const rideRequests = await RideRequest.find({
      status: { $in: ['searching', 'pending'] },
      expiresAt: { $gt: new Date() }
    })
      .populate('rider', 'firstName lastName rating totalRides')
      .sort({ createdAt: -1 })
      .limit(20);

    console.log('🔧 Found ride requests:', rideRequests.length);
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

// Rider updates offered fare while still searching/pending.
router.patch('/:requestId/fare', authenticateJWT, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { offeredFare } = req.body || {};
    const numericFare = Number(offeredFare);

    if (req.user.userType !== 'rider') {
      return res.status(403).json({ error: 'Only riders can update fare' });
    }

    if (!Number.isFinite(numericFare) || numericFare <= 0) {
      return res.status(400).json({ error: 'Valid offeredFare is required' });
    }

    const rideRequest = await RideRequest.findById(requestId);
    if (!rideRequest) {
      return res.status(404).json({ error: 'Ride request not found' });
    }

    if (String(rideRequest.rider) !== String(req.user._id)) {
      return res.status(403).json({ error: 'Not allowed to update this ride request' });
    }

    if (!['searching', 'pending'].includes(rideRequest.status)) {
      return res.status(400).json({ error: 'Cannot update fare after ride is accepted/started' });
    }

    rideRequest.requestedPrice = numericFare;
    rideRequest.suggestedPrice = numericFare;
    await rideRequest.save();

    const payload = {
      rideRequestId: String(rideRequest._id),
      requestedPrice: numericFare,
      offeredFare: numericFare,
      estimatedFare: numericFare,
      updatedAt: new Date().toISOString(),
    };

    const driverIds = collectRelevantDriverIds(rideRequest);
    driverIds.forEach((driverId) => emitToUserFromApp(req, driverId, 'ride_request_updated', payload));

    res.json({
      message: 'Fare updated successfully',
      rideRequestId: String(rideRequest._id),
      offeredFare: numericFare,
    });
  } catch (error) {
    console.error('Error updating ride request fare:', error);
    res.status(500).json({ error: 'Failed to update fare' });
  }
});

// Driver responds to a ride request
router.post('/:requestId/respond', authenticateJWT, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { action, counterOffer } = req.body; // action: 'accept', 'counter_offer', 'reject' (+ aliases)

    // Normalize action values coming from different frontend components.
    // This prevents 400 "Invalid action" when the UI sends e.g. "negotiate".
    const normalizedAction = (typeof action === 'string')
      ? action.trim().toLowerCase()
      : action;

    let actionToUse = normalizedAction;
    if (actionToUse === 'negotiate') actionToUse = 'counter_offer';
    if (actionToUse === 'decline') actionToUse = 'reject';
    if (actionToUse === 'accepted') actionToUse = 'accept';
    if (actionToUse === 'counteroffer' || actionToUse === 'counter-offer') actionToUse = 'counter_offer';

    console.log('🔧 Driver respond received:', {
      requestId,
      rawAction: action,
      normalizedAction,
      actionToUse,
      counterOffer,
    });

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

    // Find driver in available drivers list.
    // If missing (race/edge case), append a minimal entry so offer/response can proceed.
    let driverIndex = rideRequest.availableDrivers.findIndex(
      d => d.driver.toString() === req.user._id.toString()
    );

    if (driverIndex === -1) {
      rideRequest.availableDrivers.push({
        driver: req.user._id,
        status: 'viewed',
        viewedAt: new Date(),
      });
      driverIndex = rideRequest.availableDrivers.length - 1;
    }

    const driverResponse = rideRequest.availableDrivers[driverIndex];

    switch (actionToUse) {
      case 'accept':
        // Driver "accept" here means "send offer" to rider; final assignment happens on rider acceptance.
        driverResponse.status = 'accepted';
        driverResponse.respondedAt = new Date();
        if (counterOffer && Number(counterOffer) > 0) {
          driverResponse.counterOffer = Number(counterOffer);
        }

        await rideRequest.save();

        const driverProfile = await Driver.findOne({ user: req.user._id })
          .select('firstName lastName rating vehicleType vehicleModel');
        const offerFare = (counterOffer && Number(counterOffer) > 0)
          ? Number(counterOffer)
          : (rideRequest.requestedPrice || rideRequest.suggestedPrice || 0);
        const arrivalTime = Math.floor(Math.random() * 10) + 5;

        emitToUserFromApp(req, String(rideRequest.rider), 'fare_offer', {
          rideRequestId: String(rideRequest._id),
          driverId: String(req.user._id),
          driverName: driverProfile
            ? `${driverProfile.firstName || ''} ${driverProfile.lastName || ''}`.trim() || 'Driver'
            : 'Driver',
          driverRating: driverProfile ? (driverProfile.rating ?? 0) : 0,
          fareAmount: offerFare,
          arrivalTime,
          vehicleInfo: driverProfile
            ? `${driverProfile.vehicleType || ''} ${driverProfile.vehicleModel || ''}`.trim() || 'Vehicle'
            : 'Vehicle',
          timestamp: Date.now(),
        });

        res.json({
          message: 'Offer sent to rider successfully',
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

// Cancel ride request (rider: searching/pending/accepted/in_progress; accepted driver: accepted/in_progress)
router.post('/:requestId/cancel', authenticateJWT, async (req, res) => {
  try {
    const { requestId } = req.params;

    const rideRequest = await RideRequest.findById(requestId);
    if (!rideRequest) {
      return res.status(404).json({ error: 'Ride request not found' });
    }

    const uid = req.user._id.toString();
    const isRider = rideRequest.rider.toString() === uid;
    const isAcceptedDriver =
      rideRequest.acceptedBy && rideRequest.acceptedBy.toString() === uid;

    const cancellableStatuses = ['searching', 'pending', 'accepted', 'in_progress'];
    if (!cancellableStatuses.includes(rideRequest.status)) {
      return res.status(400).json({ error: 'Cannot cancel this ride at this stage' });
    }

    if (req.user.userType === 'rider') {
      if (!isRider) {
        return res.status(403).json({ error: 'Not authorized to cancel this request' });
      }
    } else if (req.user.userType === 'driver') {
      if (!isAcceptedDriver) {
        return res.status(403).json({ error: 'Not authorized to cancel this request' });
      }
    } else {
      return res.status(403).json({ error: 'Not authorized to cancel this request' });
    }

    const oldStatus = rideRequest.status;
    rideRequest.status = 'cancelled';
    rideRequest.cancelledAt = new Date();
    await rideRequest.save();

    console.log(
      `🚫 Ride request ${requestId} cancelled by ${uid} (${req.user.userType}) — ${oldStatus} → cancelled`
    );

    notifyRideCancellationRealtime(req, rideRequest, requestId, uid);

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

// Rider starts searching for drivers (UI helper)
router.post('/:requestId/start-searching', authenticateJWT, async (req, res) => {
  try {
    const { requestId } = req.params;
    const rideRequest = await RideRequest.findById(requestId);
    if (!rideRequest) return res.status(404).json({ error: 'Ride request not found' });

    if (rideRequest.rider.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // If ride is already accepted/in progress/completed, do nothing.
    if (!['searching', 'pending'].includes(rideRequest.status)) {
      return res.status(200).json({ message: 'Search already stopped', status: rideRequest.status });
    }

    rideRequest.status = 'searching';
    await rideRequest.save();
    return res.status(200).json({ message: 'Search started', status: rideRequest.status });
  } catch (error) {
    console.error('Error starting search:', error);
    return res.status(500).json({ error: 'Failed to start searching' });
  }
});

// Rider stops searching for drivers (UI helper)
router.post('/:requestId/stop-searching', authenticateJWT, async (req, res) => {
  try {
    const { requestId } = req.params;
    const rideRequest = await RideRequest.findById(requestId);
    if (!rideRequest) return res.status(404).json({ error: 'Ride request not found' });

    if (rideRequest.rider.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // If ride was already accepted, don't treat this as an error.
    if (!['searching', 'pending'].includes(rideRequest.status)) {
      return res.status(200).json({ message: 'Search already stopped', status: rideRequest.status });
    }

    rideRequest.status = 'cancelled';
    rideRequest.cancelledAt = new Date();
    await rideRequest.save();

    notifyRideCancellationRealtime(req, rideRequest, requestId, req.user._id.toString());

    return res.status(200).json({ message: 'Stopped searching', newStatus: 'cancelled' });
  } catch (error) {
    console.error('Error stopping search:', error);
    return res.status(500).json({ error: 'Failed to stop searching' });
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

module.exports = router;
