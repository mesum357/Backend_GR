const express = require('express');
const User = require('../models/User');
const { authenticateJWT } = require('../middleware/auth');
const router = express.Router();

// Get current user profile
router.get('/profile', authenticateJWT, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: user.getPublicProfile() });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

// Get all users (admin only)
router.get('/', authenticateJWT, async (req, res) => {
  try {
    const users = await User.find({}).select('-password');
    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Get user by ID
router.get('/:userId', authenticateJWT, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Update user location
router.put('/location', authenticateJWT, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        location: {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        }
      },
      { new: true }
    );

    res.json({
      message: 'Location updated successfully',
      user: user.getPublicProfile()
    });

  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// Toggle online status (for drivers)
router.put('/online-status', authenticateJWT, async (req, res) => {
  try {
    const { isOnline } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { isOnline },
      { new: true }
    );

    res.json({
      message: `Status updated to ${isOnline ? 'online' : 'offline'}`,
      user: user.getPublicProfile()
    });

  } catch (error) {
    console.error('Update online status error:', error);
    res.status(500).json({ error: 'Failed to update online status' });
  }
});

// Get nearby drivers
router.get('/nearby/drivers', authenticateJWT, async (req, res) => {
  try {
    const { latitude, longitude, radius = 5000 } = req.query; // radius in meters

    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const drivers = await User.find({
      userType: 'driver',
      isOnline: true,
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(longitude), parseFloat(latitude)]
          },
          $maxDistance: parseInt(radius)
        }
      }
    }).select('-password');

    res.json({ drivers });

  } catch (error) {
    console.error('Get nearby drivers error:', error);
    res.status(500).json({ error: 'Failed to get nearby drivers' });
  }
});

// Update wallet balance
router.put('/wallet', authenticateJWT, async (req, res) => {
  try {
    const { amount, operation } = req.body; // operation: 'add' or 'subtract'

    if (!amount || !operation) {
      return res.status(400).json({ error: 'Amount and operation are required' });
    }

    const user = await User.findById(req.user._id);
    let newBalance = user.wallet.balance;

    if (operation === 'add') {
      newBalance += parseFloat(amount);
    } else if (operation === 'subtract') {
      if (newBalance < parseFloat(amount)) {
        return res.status(400).json({ error: 'Insufficient balance' });
      }
      newBalance -= parseFloat(amount);
    } else {
      return res.status(400).json({ error: 'Invalid operation' });
    }

    user.wallet.balance = newBalance;
    await user.save();

    res.json({
      message: 'Wallet updated successfully',
      user: user.getPublicProfile()
    });

  } catch (error) {
    console.error('Update wallet error:', error);
    res.status(500).json({ error: 'Failed to update wallet' });
  }
});

// Get user statistics
router.get('/stats/summary', authenticateJWT, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    const stats = {
      totalRides: user.totalRides,
      rating: user.rating,
      walletBalance: user.wallet.balance,
      isOnline: user.isOnline,
      userType: user.userType
    };

    res.json({ stats });

  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({ error: 'Failed to get user statistics' });
  }
});

module.exports = router;
