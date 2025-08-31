const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { authenticateLocal, authenticateJWT, generateToken } = require('../middleware/auth');
const router = express.Router();

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone, userType, driverInfo } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [{ email: email.toLowerCase() }, { phone }] 
    });

    if (existingUser) {
      return res.status(400).json({ 
        error: 'User with this email or phone number already exists' 
      });
    }

    // Create new user
    const user = new User({
      email: email.toLowerCase(),
      password,
      firstName,
      lastName,
      phone,
      userType: userType || 'rider'
    });

    await user.save();

    // If registering as driver, create driver profile
    if (userType === 'driver' && driverInfo) {
      try {
        const Driver = require('../models/Driver');
        
        const driverData = {
          user: user._id,
          vehicleInfo: driverInfo.vehicleInfo,
          licenseNumber: driverInfo.licenseNumber,
          licenseExpiry: new Date(driverInfo.licenseExpiry),
          insuranceNumber: driverInfo.insuranceNumber,
          insuranceExpiry: new Date(driverInfo.insuranceExpiry),
          currentLocation: {
            type: 'Point',
            coordinates: [74.3144, 35.9208] // Default to Gilgit City Center
          }
        };

        console.log('Creating driver profile with data:', driverData);
        const driver = await Driver.createDriverProfile(user._id, driverData);
        console.log('Driver profile created successfully:', driver._id);
      } catch (driverError) {
        console.error('Error creating driver profile:', driverError);
        // Don't fail the registration if driver profile creation fails
        // The user can still register and create driver profile later
      }
    }

    // Generate JWT token
    const token = generateToken(user);

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: user.getPublicProfile()
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login user
router.post('/login', authenticateLocal, (req, res) => {
  try {
    const token = generateToken(req.user);
    
    res.json({
      message: 'Login successful',
      token,
      user: req.user.getPublicProfile()
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout user
router.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ message: 'Logout successful' });
  });
});

// Get current user profile
router.get('/profile', authenticateJWT, (req, res) => {
  res.json({
    user: req.user.getPublicProfile()
  });
});

// Update user profile
router.put('/profile', authenticateJWT, async (req, res) => {
  try {
    const { firstName, lastName, phone, profileImage, preferences } = req.body;
    
    const updates = {};
    if (firstName) updates.firstName = firstName;
    if (lastName) updates.lastName = lastName;
    if (phone) updates.phone = phone;
    if (profileImage) updates.profileImage = profileImage;
    if (preferences) updates.preferences = { ...req.user.preferences, ...preferences };

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true }
    );

    res.json({
      message: 'Profile updated successfully',
      user: user.getPublicProfile()
    });

  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Profile update failed' });
  }
});

// Change password
router.put('/change-password', authenticateJWT, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    // Verify current password
    const isMatch = await req.user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Update password
    req.user.password = newPassword;
    await req.user.save();

    res.json({ message: 'Password changed successfully' });

  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Password change failed' });
  }
});

// Forgot password (send reset email)
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate reset token (you can implement email sending here)
    const resetToken = generateToken(user);
    
    // For now, just return the token (in production, send via email)
    res.json({ 
      message: 'Password reset instructions sent to your email',
      resetToken // Remove this in production
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// Reset password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    // Verify token and get user
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret');
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password reset successfully' });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

module.exports = router;
