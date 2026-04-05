const express = require('express');
const crypto = require('crypto');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const WhatsappOtp = require('../models/WhatsappOtp');
const {
  normalizeRiderPhone,
  hashWhatsappOtp,
  verifyWhatsappOtpHash,
  WHATSAPP_OTP_PURPOSE,
  isValidInternationalPhone,
} = require('../lib/riderPhoneVerification');
const { sendWhatsappOtpMessage } = require('../lib/sendWhatsappOtpMessage');
const { authenticateLocal, authenticateJWT, generateToken } = require('../middleware/auth');
const router = express.Router();

async function upsertWhatsappOtpAndSend(phoneNorm, purpose, sendIntent) {
  const prev = await WhatsappOtp.findOne({ phone: phoneNorm, purpose });
  if (prev && Date.now() - new Date(prev.updatedAt).getTime() < 55_000) {
    return { ok: false, kind: 'RATE', message: 'Please wait about a minute before requesting another code' };
  }
  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = hashWhatsappOtp(phoneNorm, purpose, code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await WhatsappOtp.findOneAndUpdate(
    { phone: phoneNorm, purpose },
    { $set: { codeHash, expiresAt, attempts: 0 } },
    { upsert: true, new: true }
  );
  const sendResult = await sendWhatsappOtpMessage(phoneNorm, code, {
    intent: sendIntent === 'password_reset' ? 'password_reset' : 'signup',
  });
  if (!sendResult.ok && !sendResult.dev) {
    await WhatsappOtp.deleteOne({ phone: phoneNorm, purpose });
    return { ok: false, kind: 'SEND', message: 'Could not send WhatsApp. Try again later or contact support.' };
  }
  return { ok: true };
}

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

    const sent = await upsertWhatsappOtpAndSend(norm, WHATSAPP_OTP_PURPOSE.rider_register, 'signup');
    if (!sent.ok && sent.kind === 'RATE') {
      return res.status(429).json({ error: sent.message });
    }
    if (!sent.ok) {
      return res.status(502).json({ error: sent.message });
    }

    return res.json({
      message: 'Verification code sent to your WhatsApp',
    });
  } catch (err) {
    console.error('rider whatsapp send-code error:', err);
    return res.status(500).json({ error: 'Failed to send verification code' });
  }
});

/** Driver signup: send 6-digit code; after verify, registration creates pending admin approval request. */
router.post('/driver/whatsapp/send-code', async (req, res) => {
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
    const existing = await User.findOne({
      $or: [{ phone: norm }, { phone: rawTrim }],
    });
    if (existing) {
      return res.status(400).json({ error: 'An account with this phone number already exists' });
    }

    const sent = await upsertWhatsappOtpAndSend(norm, WHATSAPP_OTP_PURPOSE.driver_register, 'signup');
    if (!sent.ok && sent.kind === 'RATE') {
      return res.status(429).json({ error: sent.message });
    }
    if (!sent.ok) {
      return res.status(502).json({ error: sent.message });
    }

    return res.json({ message: 'Verification code sent to your WhatsApp' });
  } catch (err) {
    console.error('driver whatsapp send-code error:', err);
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
    /** Production: unset requires WhatsApp OTP. Set to 0 for automated tests. */
    const riderOtpRequired = process.env.RIDER_WHATSAPP_OTP_REQUIRED !== '0';
    const driverOtpRequired = process.env.DRIVER_WHATSAPP_OTP_REQUIRED !== '0';

    async function consumeWhatsappOtpOr400(phoneNorm, purpose, otpRaw) {
      const otp = String(otpRaw || '').trim();
      if (!/^\d{6}$/.test(otp)) {
        return { error: 'Enter the 6-digit code sent to your WhatsApp (use “Send WhatsApp code” first)' };
      }
      const doc = await WhatsappOtp.findOne({ phone: phoneNorm, purpose });
      if (!doc || doc.expiresAt.getTime() < Date.now()) {
        return { error: 'Code expired or not found. Send a new WhatsApp code and try again.' };
      }
      if (doc.attempts >= 8) {
        await WhatsappOtp.deleteOne({ _id: doc._id });
        return { error: 'Too many failed attempts. Request a new WhatsApp code.' };
      }
      if (!verifyWhatsappOtpHash(phoneNorm, purpose, otp, doc.codeHash)) {
        await WhatsappOtp.updateOne({ _id: doc._id }, { $inc: { attempts: 1 } });
        return { error: 'Invalid WhatsApp verification code' };
      }
      await WhatsappOtp.deleteOne({ _id: doc._id });
      return null;
    }

    if (resolvedType === 'rider' && riderOtpRequired) {
      const bad = await consumeWhatsappOtpOr400(
        normalizedPhone,
        WHATSAPP_OTP_PURPOSE.rider_register,
        whatsappOtp
      );
      if (bad) return res.status(400).json({ error: bad.error });
    }

    if (resolvedType === 'driver' && driverOtpRequired) {
      const bad = await consumeWhatsappOtpOr400(
        normalizedPhone,
        WHATSAPP_OTP_PURPOSE.driver_register,
        whatsappOtp
      );
      if (bad) return res.status(400).json({ error: bad.error });
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

    // Create new user (phone normalized after WhatsApp verification when required)
    const user = new User({
      email: email.toLowerCase(),
      password,
      firstName,
      lastName,
      phone: normalizedPhone,
      userType: resolvedType,
      profileImage: profileImage || null,
      isVerified: resolvedType === 'rider' || resolvedType === 'driver',
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

// Forgot password — send 6-digit code to WhatsApp (body: { phone, userType: "rider"|"driver" })
router.post('/forgot-password', async (req, res) => {
  try {
    const { phone, userType } = req.body;
    const ut = String(userType || '').toLowerCase();
    if (!phone || !['rider', 'driver'].includes(ut)) {
      return res.status(400).json({ error: 'Phone and user type (rider or driver) are required' });
    }
    const norm = normalizeRiderPhone(phone);
    if (!isValidInternationalPhone(norm)) {
      return res.status(400).json({
        error: 'Use a valid number with country code (e.g. +923001234567)',
      });
    }
    const rawTrim = String(phone).trim().replace(/\s/g, '');
    const user = await User.findOne({
      userType: ut,
      $or: [{ phone: norm }, { phone: rawTrim }],
    });

    const genericMessage = {
      message: 'If an account exists for this number, we sent a WhatsApp code.',
    };

    if (!user) {
      return res.json(genericMessage);
    }

    const sent = await upsertWhatsappOtpAndSend(norm, WHATSAPP_OTP_PURPOSE.password_reset, 'password_reset');
    if (!sent.ok && sent.kind === 'RATE') {
      return res.status(429).json({ error: sent.message });
    }
    if (!sent.ok) {
      return res.status(502).json({ error: sent.message });
    }

    return res.json(genericMessage);
  } catch (error) {
    console.error('Forgot password (WhatsApp) error:', error);
    res.status(500).json({ error: 'Password reset request failed' });
  }
});

// Reset password — WhatsApp code (body: { phone, userType, code, newPassword }) or legacy JWT { token, newPassword }
router.post('/reset-password', async (req, res) => {
  try {
    const { phone, userType, code, newPassword, token } = req.body;

    if (token && newPassword && !phone) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret');
        const user = await User.findById(decoded.id);
        if (!user) {
          return res.status(400).json({ error: 'Invalid or expired token' });
        }
        user.password = newPassword;
        await user.save();
        return res.json({ message: 'Password reset successfully' });
      } catch (e) {
        console.error('Reset password (JWT) error:', e);
        return res.status(400).json({ error: 'Invalid or expired token' });
      }
    }

    const ut = String(userType || '').toLowerCase();
    if (!phone || !['rider', 'driver'].includes(ut) || !code || !newPassword) {
      return res.status(400).json({
        error: 'Phone, user type (rider or driver), WhatsApp code, and new password are required',
      });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const norm = normalizeRiderPhone(phone);
    const rawTrim = String(phone).trim().replace(/\s/g, '');
    const doc = await WhatsappOtp.findOne({
      phone: norm,
      purpose: WHATSAPP_OTP_PURPOSE.password_reset,
    });
    if (!doc || doc.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: 'Invalid or expired code. Request a new code from Forgot password.' });
    }
    if (doc.attempts >= 8) {
      await WhatsappOtp.deleteOne({ _id: doc._id });
      return res.status(400).json({ error: 'Too many attempts. Request a new WhatsApp code.' });
    }
    const otp = String(code).trim();
    if (!verifyWhatsappOtpHash(norm, WHATSAPP_OTP_PURPOSE.password_reset, otp, doc.codeHash)) {
      await WhatsappOtp.updateOne({ _id: doc._id }, { $inc: { attempts: 1 } });
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    const user = await User.findOne({
      userType: ut,
      $or: [{ phone: norm }, { phone: rawTrim }],
    });
    if (!user) {
      await WhatsappOtp.deleteOne({ _id: doc._id });
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    user.password = newPassword;
    await user.save();
    await WhatsappOtp.deleteOne({ _id: doc._id });

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

module.exports = router;
