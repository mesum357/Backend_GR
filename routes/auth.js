const express = require('express');
const crypto = require('crypto');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const EmailVerificationOtp = require('../models/EmailVerificationOtp');
const { normalizeRiderPhone } = require('../lib/riderPhoneVerification');
const {
  EMAIL_OTP_PURPOSE,
  normalizeSignupEmail,
  hashEmailOtp,
  verifyEmailOtpHash,
  isValidEmail,
} = require('../lib/emailOtpCrypto');
const { sendEmailVerificationCode } = require('../lib/sendTransactionalEmail');
const { validateSignupPassword } = require('../lib/signupPasswordPolicy');
const { authenticateLocal, authenticateJWT, generateToken } = require('../middleware/auth');
const router = express.Router();

function smtpErrorMessage(err) {
  if (!err) return 'Could not send email. Try again later.';
  const m = err.message || err.response || String(err);
  return typeof m === 'string' && m.length > 220 ? `${m.slice(0, 220)}…` : String(m);
}

async function upsertEmailOtpAndSend(emailNorm, purpose, mailKind) {
  const prev = await EmailVerificationOtp.findOne({ email: emailNorm, purpose });
  if (prev && Date.now() - new Date(prev.updatedAt).getTime() < 55_000) {
    return { ok: false, kind: 'RATE', message: 'Please wait about a minute before requesting another code' };
  }
  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = hashEmailOtp(emailNorm, purpose, code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await EmailVerificationOtp.findOneAndUpdate(
    { email: emailNorm, purpose },
    { $set: { codeHash, expiresAt, attempts: 0 } },
    { upsert: true, new: true }
  );
  const sendResult = await sendEmailVerificationCode(emailNorm, code, mailKind);

  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const allowConsoleFallback =
    !isProduction || process.env.ALLOW_EMAIL_VERIFICATION_CONSOLE === '1';

  if (!sendResult.ok) {
    await EmailVerificationOtp.deleteOne({ email: emailNorm, purpose });
    return { ok: false, kind: 'SEND', message: smtpErrorMessage(sendResult.error) };
  }
  if (sendResult.dev && !allowConsoleFallback) {
    await EmailVerificationOtp.deleteOne({ email: emailNorm, purpose });
    return {
      ok: false,
      kind: 'SEND',
      message:
        'Email is not configured on this server. Set SMTP_HOST, SMTP_USER, SMTP_PASS (optional: SMTP_PORT, SMTP_FROM, SMTP_SECURE).',
    };
  }
  return { ok: true };
}

/** Rider signup: send 6-digit code to email (Nodemailer / SMTP). */
router.post('/rider/email/send-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }
    const emailNorm = normalizeSignupEmail(email);
    if (!isValidEmail(emailNorm)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }

    const existing = await User.findOne({ email: emailNorm });
    if (existing) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    const sent = await upsertEmailOtpAndSend(emailNorm, EMAIL_OTP_PURPOSE.rider_register, 'signup');
    if (!sent.ok && sent.kind === 'RATE') {
      return res.status(429).json({ error: sent.message });
    }
    if (!sent.ok) {
      return res.status(502).json({ error: sent.message });
    }

    return res.json({ message: 'Verification code sent to your email' });
  } catch (err) {
    console.error('rider email send-code error:', err);
    return res.status(500).json({ error: 'Failed to send verification code' });
  }
});

/** Driver signup: send 6-digit code to email; after verify, registration goes to admin approval. */
router.post('/driver/email/send-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }
    const emailNorm = normalizeSignupEmail(email);
    if (!isValidEmail(emailNorm)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }

    const existing = await User.findOne({ email: emailNorm });
    if (existing) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    const sent = await upsertEmailOtpAndSend(emailNorm, EMAIL_OTP_PURPOSE.driver_register, 'signup');
    if (!sent.ok && sent.kind === 'RATE') {
      return res.status(429).json({ error: sent.message });
    }
    if (!sent.ok) {
      return res.status(502).json({ error: sent.message });
    }

    return res.json({ message: 'Verification code sent to your email' });
  } catch (err) {
    console.error('driver email send-code error:', err);
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
      emailVerificationCode,
    } = req.body;

    const resolvedType = userType || 'rider';
    const rawPhone = String(phone || '').trim();
    const normalizedPhone = normalizeRiderPhone(phone);
    const emailNorm = normalizeSignupEmail(email);
    const pwPolicyErr = validateSignupPassword(password, emailNorm);
    if (pwPolicyErr) {
      return res.status(400).json({ error: pwPolicyErr });
    }
    /** Unset or any value except "0" requires email OTP. Set EMAIL_VERIFICATION_REQUIRED=0 for automated tests. */
    const emailOtpRequired = process.env.EMAIL_VERIFICATION_REQUIRED !== '0';
    const otpInput = emailVerificationCode ?? req.body.emailOtp ?? req.body.whatsappOtp;

    async function consumeEmailOtpOr400(emailKey, purpose, otpRaw) {
      const otp = String(otpRaw || '').trim();
      if (!/^\d{6}$/.test(otp)) {
        return {
          error: 'Enter the 6-digit code sent to your email (use “Send verification code” first)',
        };
      }
      const doc = await EmailVerificationOtp.findOne({ email: emailKey, purpose });
      if (!doc || doc.expiresAt.getTime() < Date.now()) {
        return { error: 'Code expired or not found. Request a new verification email.' };
      }
      if (doc.attempts >= 8) {
        await EmailVerificationOtp.deleteOne({ _id: doc._id });
        return { error: 'Too many failed attempts. Request a new verification code.' };
      }
      if (!verifyEmailOtpHash(emailKey, purpose, otp, doc.codeHash)) {
        await EmailVerificationOtp.updateOne({ _id: doc._id }, { $inc: { attempts: 1 } });
        return { error: 'Invalid verification code' };
      }
      await EmailVerificationOtp.deleteOne({ _id: doc._id });
      return null;
    }

    if (resolvedType === 'rider' && emailOtpRequired) {
      const bad = await consumeEmailOtpOr400(emailNorm, EMAIL_OTP_PURPOSE.rider_register, otpInput);
      if (bad) return res.status(400).json({ error: bad.error });
    }

    if (resolvedType === 'driver' && emailOtpRequired) {
      const bad = await consumeEmailOtpOr400(emailNorm, EMAIL_OTP_PURPOSE.driver_register, otpInput);
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

    // Create new user (phone normalized; email verified when required)
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

    const pwErr = validateSignupPassword(newPassword, String(req.user.email || '').toLowerCase());
    if (pwErr) {
      return res.status(400).json({ error: pwErr });
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

// Forgot password — send 6-digit code to email (body: { email, userType: "rider"|"driver" })
router.post('/forgot-password', async (req, res) => {
  try {
    const { email, userType } = req.body;
    const ut = String(userType || '').toLowerCase();
    if (!email || !['rider', 'driver'].includes(ut)) {
      return res.status(400).json({ error: 'Email and user type (rider or driver) are required' });
    }
    const emailNorm = normalizeSignupEmail(email);
    if (!isValidEmail(emailNorm)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }

    const user = await User.findOne({ email: emailNorm, userType: ut });

    const genericMessage = {
      message: 'If an account exists for this email, we sent a verification code.',
    };

    if (!user) {
      return res.json(genericMessage);
    }

    const sent = await upsertEmailOtpAndSend(emailNorm, EMAIL_OTP_PURPOSE.password_reset, 'password_reset');
    if (!sent.ok && sent.kind === 'RATE') {
      return res.status(429).json({ error: sent.message });
    }
    if (!sent.ok) {
      return res.status(502).json({ error: sent.message });
    }

    return res.json(genericMessage);
  } catch (error) {
    console.error('Forgot password (email) error:', error);
    res.status(500).json({ error: 'Password reset request failed' });
  }
});

// Reset password — email code (body: { email, userType, code, newPassword }) or legacy JWT { token, newPassword }
router.post('/reset-password', async (req, res) => {
  try {
    const { email, userType, code, newPassword, token } = req.body;

    if (token && newPassword && !email) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-jwt-secret');
        const user = await User.findById(decoded.id);
        if (!user) {
          return res.status(400).json({ error: 'Invalid or expired token' });
        }
        const jwtPwErr = validateSignupPassword(newPassword, String(user.email || '').toLowerCase());
        if (jwtPwErr) {
          return res.status(400).json({ error: jwtPwErr });
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
    if (!email || !['rider', 'driver'].includes(ut) || !code || !newPassword) {
      return res.status(400).json({
        error: 'Email, user type (rider or driver), verification code, and new password are required',
      });
    }
    const emailNorm = normalizeSignupEmail(email);
    const pwErr = validateSignupPassword(newPassword, emailNorm);
    if (pwErr) {
      return res.status(400).json({ error: pwErr });
    }

    const doc = await EmailVerificationOtp.findOne({
      email: emailNorm,
      purpose: EMAIL_OTP_PURPOSE.password_reset,
    });
    if (!doc || doc.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: 'Invalid or expired code. Request a new code from Forgot password.' });
    }
    if (doc.attempts >= 8) {
      await EmailVerificationOtp.deleteOne({ _id: doc._id });
      return res.status(400).json({ error: 'Too many attempts. Request a new email code.' });
    }
    const otp = String(code).trim();
    if (!verifyEmailOtpHash(emailNorm, EMAIL_OTP_PURPOSE.password_reset, otp, doc.codeHash)) {
      await EmailVerificationOtp.updateOne({ _id: doc._id }, { $inc: { attempts: 1 } });
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    const user = await User.findOne({ email: emailNorm, userType: ut });
    if (!user) {
      await EmailVerificationOtp.deleteOne({ _id: doc._id });
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    user.password = newPassword;
    await user.save();
    await EmailVerificationOtp.deleteOne({ _id: doc._id });

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

module.exports = router;
