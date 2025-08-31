const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
// You'll need to download your service account key from Firebase Console
// and place it in the config folder or use environment variables

let serviceAccount;
try {
  // Try to load service account from file
  serviceAccount = require('../serviceAccountKey.json');
} catch (error) {
  // If file doesn't exist, try to load from environment variables
  serviceAccount = {
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
  };
}

// Initialize Firebase Admin
let firebaseAdmin;
try {
  // Check if we have valid service account credentials
  if (!serviceAccount || !serviceAccount.project_id || !serviceAccount.private_key) {
    throw new Error('Invalid or missing Firebase service account credentials');
  }
  
  firebaseAdmin = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${serviceAccount.project_id}.firebaseio.com`
  });
  console.log('Firebase Admin SDK initialized successfully');
} catch (error) {
  console.error('Firebase Admin SDK initialization error:', error.message);
  console.log('Firebase features will be disabled. Please check your Firebase configuration.');
  firebaseAdmin = null;
}

// Export Firebase Admin instance
module.exports = {
  admin: firebaseAdmin,
  auth: firebaseAdmin ? firebaseAdmin.auth() : null,
  firestore: firebaseAdmin ? firebaseAdmin.firestore() : null,
  storage: firebaseAdmin ? firebaseAdmin.storage() : null
};

// Helper functions for Firebase operations
const firebaseHelpers = {
  // Verify Firebase ID token
  verifyIdToken: async (idToken) => {
    if (!firebaseAdmin) {
      throw new Error('Firebase Admin SDK not initialized');
    }
    try {
      const decodedToken = await firebaseAdmin.auth().verifyIdToken(idToken);
      return decodedToken;
    } catch (error) {
      throw new Error('Invalid Firebase ID token');
    }
  },

  // Create custom token
  createCustomToken: async (uid, additionalClaims = {}) => {
    if (!firebaseAdmin) {
      throw new Error('Firebase Admin SDK not initialized');
    }
    try {
      const customToken = await firebaseAdmin.auth().createCustomToken(uid, additionalClaims);
      return customToken;
    } catch (error) {
      throw new Error('Failed to create custom token');
    }
  },

  // Get user by UID
  getUserByUid: async (uid) => {
    if (!firebaseAdmin) {
      throw new Error('Firebase Admin SDK not initialized');
    }
    try {
      const userRecord = await firebaseAdmin.auth().getUser(uid);
      return userRecord;
    } catch (error) {
      throw new Error('User not found');
    }
  },

  // Update user profile
  updateUserProfile: async (uid, updates) => {
    if (!firebaseAdmin) {
      throw new Error('Firebase Admin SDK not initialized');
    }
    try {
      const userRecord = await firebaseAdmin.auth().updateUser(uid, updates);
      return userRecord;
    } catch (error) {
      throw new Error('Failed to update user profile');
    }
  }
};

module.exports.helpers = firebaseHelpers;
