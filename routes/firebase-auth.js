const express = require('express');
const router = express.Router();
const { helpers } = require('../config/firebase');
const User = require('../models/User');
const { generateToken } = require('../middleware/auth');

// Firebase-based user registration
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone, userType, firebaseUid } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [{ email: email.toLowerCase() }, { phone }] 
    });

    if (existingUser) {
      return res.status(400).json({ 
        error: 'User with this email or phone number already exists' 
      });
    }

    // Create new user with Firebase UID
    const user = new User({
      email: email.toLowerCase(),
      password,
      firstName,
      lastName,
      phone,
      userType: userType || 'rider',
      firebaseUid: firebaseUid || null
    });

    await user.save();

    // Generate JWT token
    const token = generateToken(user);

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: user.getPublicProfile()
    });

  } catch (error) {
    console.error('Firebase registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Firebase-based user login
router.post('/login', async (req, res) => {
  try {
    const { email, password, firebaseUid } = req.body;

    // Find user by email or Firebase UID
    let user;
    if (firebaseUid) {
      user = await User.findOne({ firebaseUid });
    } else {
      user = await User.findOne({ email: email.toLowerCase() });
    }

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Verify password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = generateToken(user);

    res.json({
      message: 'Login successful',
      token,
      user: user.getPublicProfile()
    });

  } catch (error) {
    console.error('Firebase login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Firebase token verification and user creation/update
router.post('/verify-token', async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: 'Firebase ID token is required' });
    }

    // Verify Firebase ID token
    const decodedToken = await helpers.verifyIdToken(idToken);
    
    // Check if user exists in our database
    let user = await User.findOne({ firebaseUid: decodedToken.uid });

    if (!user) {
      // Create new user from Firebase data
      user = new User({
        email: decodedToken.email,
        firstName: decodedToken.name?.split(' ')[0] || 'User',
        lastName: decodedToken.name?.split(' ').slice(1).join(' ') || '',
        firebaseUid: decodedToken.uid,
        userType: 'rider',
        phone: decodedToken.phone_number || '',
        password: 'firebase-auth-' + Math.random().toString(36).substring(7) // Generate random password
      });

      await user.save();
    }

    // Generate JWT token
    const token = generateToken(user);

    res.json({
      message: 'Firebase authentication successful',
      token,
      user: user.getPublicProfile(),
      isNewUser: !user.createdAt || (Date.now() - user.createdAt.getTime()) < 60000 // User created in last minute
    });

  } catch (error) {
    console.error('Firebase token verification error:', error);
    res.status(401).json({ error: 'Invalid Firebase ID token' });
  }
});

// Get user profile by Firebase UID
router.get('/profile/:firebaseUid', async (req, res) => {
  try {
    const { firebaseUid } = req.params;
    
    const user = await User.findOne({ firebaseUid });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: user.getPublicProfile()
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

// Update user profile
router.put('/profile/:firebaseUid', async (req, res) => {
  try {
    const { firebaseUid } = req.params;
    const updates = req.body;

    const user = await User.findOne({ firebaseUid });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update allowed fields
    if (updates.firstName) user.firstName = updates.firstName;
    if (updates.lastName) user.lastName = updates.lastName;
    if (updates.phone) user.phone = updates.phone;
    if (updates.userType) user.userType = updates.userType;
    if (updates.profileImage) user.profileImage = updates.profileImage;

    await user.save();

    res.json({
      message: 'Profile updated successfully',
      user: user.getPublicProfile()
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;
