const express = require('express');
const router = express.Router();
const Driver = require('../models/Driver');
const User = require('../models/User');
const { authenticateJWT } = require('../middleware/auth');

// Register as a driver
router.post('/register', authenticateJWT, async (req, res) => {
  try {
    const {
      vehicleInfo,
      licenseNumber,
      licenseExpiry,
      insuranceNumber,
      insuranceExpiry,
      bankInfo,
      preferredAreas,
      maxDistance,
      minFare,
      maxFare,
      workingHours
    } = req.body;

    // Check if user is already a driver
    const existingDriver = await Driver.findOne({ user: req.user._id });
    if (existingDriver) {
      return res.status(400).json({ error: 'User is already registered as a driver' });
    }

    // Validate required fields
    if (!vehicleInfo || !licenseNumber || !insuranceNumber) {
      return res.status(400).json({ error: 'Vehicle information, license, and insurance are required' });
    }

    // Create driver profile
    const driverData = {
      vehicleInfo,
      licenseNumber,
      licenseExpiry: new Date(licenseExpiry),
      insuranceNumber,
      insuranceExpiry: new Date(insuranceExpiry),
      bankInfo: bankInfo || {},
      preferredAreas: preferredAreas || ['Gilgit City'],
      maxDistance: maxDistance || 50,
      minFare: minFare || 50,
      maxFare: maxFare || 2000,
      workingHours: workingHours || {
        startTime: '06:00',
        endTime: '22:00',
        workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      },
      currentLocation: {
        type: 'Point',
        coordinates: [74.3144, 35.9208] // Default to Gilgit City Center
      }
    };

    const driver = await Driver.createDriverProfile(req.user._id, driverData);

    // Update user type to driver
    await User.findByIdAndUpdate(req.user._id, { userType: 'driver' });

    res.status(201).json({
      message: 'Driver registration successful',
      driver: {
        id: driver._id,
        isApproved: driver.isApproved,
        isVerified: driver.isVerified
      }
    });

  } catch (error) {
    console.error('Error registering driver:', error);
    res.status(500).json({ error: 'Failed to register as driver' });
  }
});

// Get driver profile
router.get('/profile', authenticateJWT, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user._id })
      .populate('user', 'firstName lastName email phone');

    if (!driver) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    res.json({
      driver: {
        id: driver._id,
        user: driver.user,
        vehicleInfo: driver.vehicleInfo,
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable,
        rating: driver.rating,
        totalRides: driver.totalRides,
        totalEarnings: driver.totalEarnings,
        isVerified: driver.isVerified,
        isApproved: driver.isApproved,
        currentLocation: driver.currentLocation,
        preferredAreas: driver.preferredAreas,
        workingHours: driver.workingHours,
        lastActive: driver.lastActive
      }
    });

  } catch (error) {
    console.error('Error fetching driver profile:', error);
    res.status(500).json({ error: 'Failed to fetch driver profile' });
  }
});

// Update driver profile
router.put('/profile', authenticateJWT, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user._id });
    if (!driver) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    const {
      vehicleInfo,
      preferredAreas,
      maxDistance,
      minFare,
      maxFare,
      workingHours,
      bankInfo
    } = req.body;

    // Update allowed fields
    if (vehicleInfo) driver.vehicleInfo = { ...driver.vehicleInfo, ...vehicleInfo };
    if (preferredAreas) driver.preferredAreas = preferredAreas;
    if (maxDistance) driver.maxDistance = maxDistance;
    if (minFare) driver.minFare = minFare;
    if (maxFare) driver.maxFare = maxFare;
    if (workingHours) driver.workingHours = { ...driver.workingHours, ...workingHours };
    if (bankInfo) driver.bankInfo = { ...driver.bankInfo, ...bankInfo };

    await driver.save();

    res.json({
      message: 'Driver profile updated successfully',
      driver: {
        id: driver._id,
        vehicleInfo: driver.vehicleInfo,
        preferredAreas: driver.preferredAreas,
        workingHours: driver.workingHours
      }
    });

  } catch (error) {
    console.error('Error updating driver profile:', error);
    res.status(500).json({ error: 'Failed to update driver profile' });
  }
});

// Toggle online/offline status
router.post('/toggle-status', authenticateJWT, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user._id });
    if (!driver) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    await driver.toggleOnline();

    res.json({
      message: `Driver is now ${driver.isOnline ? 'online' : 'offline'}`,
      isOnline: driver.isOnline,
      isAvailable: driver.isAvailable
    });

  } catch (error) {
    console.error('Error toggling driver status:', error);
    res.status(500).json({ error: 'Failed to toggle driver status' });
  }
});

// Update driver location
router.post('/location', authenticateJWT, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const driver = await Driver.findOne({ user: req.user._id });
    if (!driver) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    await driver.updateLocation(latitude, longitude);

    res.json({
      message: 'Location updated successfully',
      location: driver.currentLocation
    });

  } catch (error) {
    console.error('Error updating driver location:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// Get driver statistics
router.get('/stats', authenticateJWT, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user._id });
    if (!driver) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    res.json({
      stats: {
        totalRides: driver.totalRides,
        completedRides: driver.completedRides,
        cancelledRides: driver.cancelledRides,
        totalEarnings: driver.totalEarnings,
        rating: driver.rating,
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable
      }
    });

  } catch (error) {
    console.error('Error fetching driver stats:', error);
    res.status(500).json({ error: 'Failed to fetch driver statistics' });
  }
});

// Get available ride requests for driver
router.get('/available-requests', authenticateJWT, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user._id });
    if (!driver) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    if (!driver.isOnline || !driver.isAvailable) {
      return res.status(400).json({ error: 'Driver must be online to view requests' });
    }

    const { latitude, longitude, radius = 5 } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Location coordinates are required' });
    }

    // Update driver's current location
    await driver.updateLocation(parseFloat(latitude), parseFloat(longitude));

    // Get available ride requests (this will be implemented in ride-requests route)
    // For now, return empty array
    res.json({
      requests: [],
      total: 0,
      driverLocation: driver.currentLocation
    });

  } catch (error) {
    console.error('Error fetching available requests:', error);
    res.status(500).json({ error: 'Failed to fetch available requests' });
  }
});

// Check if user is registered as driver
router.get('/check-registration', authenticateJWT, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user._id });
    
    // Check if user is registered as a driver (either through Driver model or userType)
    const isDriverUser = req.user.userType === 'driver';
    const isRegistered = !!driver || isDriverUser;
    
    res.json({
      isRegistered,
      isApproved: driver ? driver.isApproved : isDriverUser, // If userType is driver, consider approved
      isVerified: driver ? driver.isVerified : isDriverUser, // If userType is driver, consider verified
      isOnline: driver ? driver.isOnline : false,
      driverProfile: driver || (isDriverUser ? { userType: 'driver' } : null)
    });

  } catch (error) {
    console.error('Error checking driver registration:', error);
    res.status(500).json({ error: 'Failed to check driver registration' });
  }
});

module.exports = router;
