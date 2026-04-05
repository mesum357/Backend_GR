const express = require('express');
const crypto = require('crypto');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const RiderWhatsappOtp = require('../models/RiderWhatsappOtp');
const {
  normalizeRiderPhone,
  hashRiderWhatsappOtp,
  verifyRiderWhatsappOtpHash,
  isValidInternationalPhone,
} = require('../lib/riderPhoneVerification');
const { sendWhatsappOtpMessage } = require('../lib/sendWhatsappOtpMessage');
const { authenticateLocal, authenticateJWT, generateToken } = require('../middleware/auth');
const router = express.Router();

/** Rider signup: send 6-digit code to WhatsApp (Meta / Twilio / dev log). */
router.post('/rider/whatsapp/send-code', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    const norm = normalizeRiderPhone(phone);
    if (!isValidInternationalPhone(norm)) {
      return res.status(400).json({
        error: 'Use a valid number with country code (e.g. +923001234567 for Pakistan)',
      });
    }

    const rawTrim = String(phone).trim().replace(/\s/g, '');
    const existingUser = await User.findOne({
      userType: 'rider',
      $or: [{ phone: norm }, { phone: rawTrim }],
    });
    if (existingUser) {
      return res.status(400).json({ error: 'An account with this phone number already exists' });
    }

    const existingOther = await User.findOne({
      userType: { $ne: 'rider' },
      $or: [{ phone: norm }, { phone: rawTrim }],
    });
    if (existingOther) {
      return res.status(400).json({ error: 'This phone number is already registered' });
    }

    const prev = await RiderWhatsappOtp.findOne({ phone: norm });
    if (prev && Date.now() - new Date(prev.updatedAt).getTime() < 55_000) {
      return res.status(429).json({ error: 'Please wait about a minute before requesting another code' });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = hashRiderWhatsappOtp(norm, code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await RiderWhatsappOtp.findOneAndUpdate(
      { phone: norm },
      { $set: { codeHash, expiresAt, attempts: 0 } },
      { upsert: true, new: true }
    );

    const sendResult = await sendWhatsappOtpMessage(norm, code);
    if (!sendResult.ok && !sendResult.dev) {
      await RiderWhatsappOtp.deleteOne({ phone: norm });
      return res.status(502).json({ error: 'Could not send WhatsApp. Try again later or contact support.' });
    }

    return res.json({
      message: 'Verification code sent to your WhatsApp',
    });
  } catch (err) {
    console.error('rider whatsapp send-code error:', err);
    return res.status(500).json({ error: 'Failed to send verification code' });
  }
});

// Register new user
router.post('/register', async (req, res) => {
  try {
    const {
      email,
      password,
      firstName,
      lastName,
      phone,
      userType,
      driverInfo,
      profileImage,
      whatsappOtp,
    } = req.body;

    const resolvedType = userType || 'rider';
    const rawPhone = String(phone || '').trim();
    const normalizedPhone = normalizeRiderPhone(phone);
    /** Production: unset or any value except "0" requires WhatsApp OTP for riders. Set to 0 for automated tests. */
    const riderOtpRequired = process.env.RIDER_WHATSAPP_OTP_REQUIRED !== '0';

    if (resolvedType === 'rider' && riderOtpRequired) {
      const otp = String(whatsappOtp || '').trim();
      if (!/^\d{6}$/.test(otp)) {
        return res.status(400).json({
          error: 'Enter the 6-digit code sent to your WhatsApp (use “Send WhatsApp code” first)',
        });
      }
      const doc = await RiderWhatsappOtp.findOne({ phone: normalizedPhone });
      if (!doc || doc.expiresAt.getTime() < Date.now()) {
        return res.status(400).json({
          error: 'Code expired or not found. Send a new WhatsApp code and try again.',
        });
      }
      if (doc.attempts >= 8) {
        await RiderWhatsappOtp.deleteOne({ _id: doc._id });
        return res.status(400).json({
          error: 'Too many failed attempts. Request a new WhatsApp code.',
        });
      }
      if (!verifyRiderWhatsappOtpHash(normalizedPhone, otp, doc.codeHash)) {
        await RiderWhatsappOtp.updateOne({ _id: doc._id }, { $inc: { attempts: 1 } });
        return res.status(400).json({ error: 'Invalid WhatsApp verification code' });
      }
      await RiderWhatsappOtp.deleteOne({ _id: doc._id });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { phone: normalizedPhone },
        { phone: rawPhone },
      ],
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
      phone: resolvedType === 'rider' ? normalizedPhone : rawPhone,
      userType: resolvedType,
      profileImage: profileImage || null,
      isVerified: resolvedType === 'rider',
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
          licenseImage: driverInfo.licenseImage || null,
          cnicFrontImage: driverInfo.cnicFrontImage || null,
          cnicBackImage: driverInfo.cnicBackImage || null,
          licenseExpiry: new Date(driverInfo.licenseExpiry),
          insuranceNumber: driverInfo.insuranceNumber,
          insuranceExpiry: new Date(driverInfo.insuranceExpiry),
          currentLocation: {
            type: 'Point',
            coordinates: [74.3144, 35.9208] // Default to Gilgit City Center
          },
          isOnline: false,
          isAvailable: false,
          isApproved: false,
          approvalStatus: 'pending',
        };

        console.log('Creating driver profile with data:', driverData);
        const driver = await Driver.createDriverProfile(user._id, driverData);
        console.log('Driver profile created successfully:', driver._id);
        console.log('Driver profile details:', {
          isApproved: driver.isApproved,
          isOnline: driver.isOnline,
          isAvailable: driver.isAvailable
        });
      } catch (driverError) {
        console.error('Error creating driver profile:', driverError);
        // Don't fail the registration if driver profile creation fails
        // The user can still register and create driver profile later
      }
    }

    // Generate JWT token
    const token = generateToken(user);

    res.status(201).json({
      message: userType === 'driver'
        ? 'Driver request submitted successfully'
        : 'User registered successfully',
      token,
      user: user.getPublicProfile()
    });

  } catch (error) {
    console.error('Registration error:', error);
    
    // Handle specific MongoDB errors
    if (error.code === 11000) {
      // Duplicate key error
      const field = Object.keys(error.keyPattern)[0];
      const message = field === 'email' 
        ? 'An account with this email already exists' 
        : field === 'phone'
        ? 'An account with this phone number already exists'
        : 'An account with this information already exists';
      return res.status(400).json({ error: message });
    }
    
    // Handle Mongoose validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ error: messages.join(', ') });
    }
    
    // Handle other known errors
    if (error.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid data format' });
    }
    
    // Generic server error
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login user
router.post('/login', authenticateLocal, (req, res) => {
  try {
    const { expectedUserType } = req.body;
    const user = req.user;
    
    // Check if expected user type is provided and valid
    if (!expectedUserType) {
      return res.status(400).json({ 
        error: 'User type must be specified for login' 
      });
    }
    
    if (!['rider', 'driver'].includes(expectedUserType)) {
      return res.status(400).json({ 
        error: 'Invalid user type. Must be either "rider" or "driver"' 
      });
    }
    
    if (user.userType !== expectedUserType) {
      const userTypeName = user.userType === 'driver' ? 'Driver' : 'Rider';
      const expectedTypeName = expectedUserType === 'driver' ? 'Driver' : 'Rider';
      
      return res.status(400).json({ 
        error: `This account is registered as a ${userTypeName}. Please use ${expectedTypeName} Login instead.`,
        userType: user.userType,
        expectedUserType: expectedUserType
      });
    }

    // Block driver login until approved
    if (expectedUserType === 'driver') {
      const Driver = require('../models/Driver');
      Driver.findOne({ user: user._id })
        .select('isApproved approvalStatus rejectionReason')
        .then((driver) => {
          if (!driver) {
            return res.status(403).json({ error: 'Driver profile not found. Please complete driver registration.' });
          }
          if (driver.approvalStatus === 'rejected') {
            const reason = driver.rejectionReason ? ` Reason: ${driver.rejectionReason}` : '';
            return res.status(403).json({ error: `Your driver request was rejected.${reason}` });
          }
          if (!driver.isApproved || driver.approvalStatus !== 'approved') {
            return res.status(403).json({ error: 'Your driver request is under review. Please wait for admin approval.' });
          }

          const token = generateToken(user);
          return res.json({
            message: 'Login successful',
            token,
            user: user.getPublicProfile()
          });
        })
        .catch((e) => {
          console.error('Driver approval check error:', e);
          return res.status(500).json({ error: 'Authentication error' });
        });
      return;
    }
    
    const token = generateToken(user);
    
    res.json({
      message: 'Login successful',
      token,
      user: user.getPublicProfile()
    });
  } catch (error) {
    console.error('Login error:', error);
    
    // Handle specific errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: 'Invalid login data' });
    }
    
    // Generic server error
    res.status(500).json({ error: 'Authentication error' });
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
