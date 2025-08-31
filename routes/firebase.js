const express = require('express');
const router = express.Router();
const { helpers } = require('../config/firebase');
const { firebaseAuth, optionalFirebaseAuth } = require('../middleware/firebase-auth');

// Get Firebase configuration status
router.get('/status', (req, res) => {
  res.json({
    firebase: helpers ? 'Available' : 'Not available',
    message: 'Firebase routes are working'
  });
});

// Create custom token for user
router.post('/custom-token', firebaseAuth, async (req, res) => {
  try {
    const { uid, additionalClaims } = req.body;
    
    if (!uid) {
      return res.status(400).json({ error: 'UID is required' });
    }

    const customToken = await helpers.createCustomToken(uid, additionalClaims || {});
    res.json({ customToken });
  } catch (error) {
    console.error('Error creating custom token:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user profile by UID
router.get('/user/:uid', firebaseAuth, async (req, res) => {
  try {
    const { uid } = req.params;
    const userRecord = await helpers.getUserByUid(uid);
    
    // Return only necessary user information
    res.json({
      uid: userRecord.uid,
      email: userRecord.email,
      emailVerified: userRecord.emailVerified,
      displayName: userRecord.displayName,
      photoURL: userRecord.photoURL,
      disabled: userRecord.disabled,
      metadata: {
        creationTime: userRecord.metadata.creationTime,
        lastSignInTime: userRecord.metadata.lastSignInTime
      }
    });
  } catch (error) {
    console.error('Error getting user:', error);
    res.status(404).json({ error: error.message });
  }
});

// Update user profile
router.put('/user/:uid', firebaseAuth, async (req, res) => {
  try {
    const { uid } = req.params;
    const updates = req.body;
    
    // Only allow updating certain fields
    const allowedUpdates = {};
    if (updates.displayName !== undefined) allowedUpdates.displayName = updates.displayName;
    if (updates.photoURL !== undefined) allowedUpdates.photoURL = updates.photoURL;
    if (updates.email !== undefined) allowedUpdates.email = updates.email;
    if (updates.password !== undefined) allowedUpdates.password = updates.password;
    if (updates.disabled !== undefined) allowedUpdates.disabled = updates.disabled;

    const userRecord = await helpers.updateUserProfile(uid, allowedUpdates);
    
    res.json({
      message: 'User updated successfully',
      user: {
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName,
        photoURL: userRecord.photoURL,
        disabled: userRecord.disabled
      }
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Verify Firebase ID token
router.post('/verify-token', async (req, res) => {
  try {
    const { idToken } = req.body;
    
    if (!idToken) {
      return res.status(400).json({ error: 'ID token is required' });
    }

    const decodedToken = await helpers.verifyIdToken(idToken);
    
    res.json({
      valid: true,
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      claims: decodedToken
    });
  } catch (error) {
    console.error('Error verifying token:', error);
    res.status(401).json({ 
      valid: false,
      error: error.message 
    });
  }
});

// Get current user info (from token)
router.get('/me', firebaseAuth, (req, res) => {
  res.json({
    user: req.user
  });
});

// Firebase Cloud Messaging (FCM) token management
router.post('/fcm-token', firebaseAuth, async (req, res) => {
  try {
    const { fcmToken, deviceType } = req.body;
    const { uid } = req.user;
    
    if (!fcmToken) {
      return res.status(400).json({ error: 'FCM token is required' });
    }

    // Here you would typically store the FCM token in your database
    // associated with the user UID for later use in push notifications
    
    // For now, we'll just acknowledge the token
    res.json({
      message: 'FCM token registered successfully',
      uid,
      fcmToken,
      deviceType: deviceType || 'unknown'
    });
  } catch (error) {
    console.error('Error registering FCM token:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send push notification (example endpoint)
router.post('/send-notification', firebaseAuth, async (req, res) => {
  try {
    const { targetUid, title, body, data } = req.body;
    
    if (!targetUid || !title || !body) {
      return res.status(400).json({ 
        error: 'targetUid, title, and body are required' 
      });
    }

    // This is a placeholder - you would implement actual FCM sending here
    // You would need to store FCM tokens in your database and use them
    
    res.json({
      message: 'Notification sent successfully',
      targetUid,
      title,
      body,
      data
    });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
