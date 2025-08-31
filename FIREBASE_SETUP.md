# Firebase Integration Setup Guide

This guide will help you set up Firebase integration for your Tourist Ride-Sharing App backend.

## Prerequisites

1. A Firebase project (create one at https://console.firebase.google.com/)
2. Node.js and npm installed
3. Firebase Admin SDK service account key

## Step 1: Install Firebase Dependencies

```bash
cd backend
npm install firebase-admin
```

## Step 2: Firebase Project Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select an existing one
3. Enable the following services:
   - Authentication
   - Firestore Database (optional)
   - Cloud Storage (optional)
   - Cloud Messaging (for push notifications)

## Step 3: Get Service Account Key

1. In Firebase Console, go to Project Settings
2. Go to Service Accounts tab
3. Click "Generate new private key"
4. Download the JSON file
5. Rename it to `serviceAccountKey.json` and place it in the `backend` folder

**⚠️ Security Note:** Never commit this file to version control. Add it to `.gitignore`.

## Step 4: Environment Variables (Alternative to Service Account File)

Instead of using a service account file, you can use environment variables. Add these to your `.env` file:

```env
# Firebase Configuration
FIREBASE_TYPE=service_account
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_PRIVATE_KEY_ID=your-private-key-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour private key here\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=your-client-id
FIREBASE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
FIREBASE_TOKEN_URI=https://oauth2.googleapis.com/token
FIREBASE_AUTH_PROVIDER_X509_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
FIREBASE_CLIENT_X509_CERT_URL=https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-xxxxx%40your-project.iam.gserviceaccount.com
FIREBASE_DATABASE_URL=https://your-project-id.firebaseio.com
```

## Step 5: Update .gitignore

Add the following to your `.gitignore` file:

```gitignore
# Firebase
serviceAccountKey.json
.env
```

## Step 6: Test Firebase Integration

1. Start your server:
   ```bash
   npm run dev
   ```

2. Test the Firebase status endpoint:
   ```bash
   curl http://localhost:5000/api/firebase/status
   ```

3. You should see a response like:
   ```json
   {
     "firebase": "Initialized",
     "auth": "Available",
     "firestore": "Available",
     "storage": "Available"
   }
   ```

## Available Firebase Endpoints

### Authentication
- `POST /api/firebase/verify-token` - Verify Firebase ID token
- `GET /api/firebase/me` - Get current user info
- `POST /api/firebase/custom-token` - Create custom token

### User Management
- `GET /api/firebase/user/:uid` - Get user profile
- `PUT /api/firebase/user/:uid` - Update user profile

### Push Notifications
- `POST /api/firebase/fcm-token` - Register FCM token
- `POST /api/firebase/send-notification` - Send push notification

## Using Firebase Authentication in Routes

You can use Firebase authentication middleware in your existing routes:

```javascript
const { firebaseAuth, requireDriver, requireRider } = require('../middleware/firebase-auth');

// Protected route with Firebase auth
router.get('/protected', firebaseAuth, (req, res) => {
  // req.user contains the authenticated user info
  res.json({ user: req.user });
});

// Driver-only route
router.get('/driver-only', firebaseAuth, requireDriver, (req, res) => {
  res.json({ message: 'Driver access granted' });
});

// Rider-only route
router.get('/rider-only', firebaseAuth, requireRider, (req, res) => {
  res.json({ message: 'Rider access granted' });
});
```

## Client-Side Integration

In your React Native app, you'll need to:

1. Install Firebase SDK:
   ```bash
   npm install @react-native-firebase/app @react-native-firebase/auth
   ```

2. Configure Firebase in your app (see React Native Firebase documentation)

3. Use Firebase authentication in your API calls:
   ```javascript
   import auth from '@react-native-firebase/auth';

   // Get ID token for API calls
   const idToken = await auth().currentUser?.getIdToken();
   
   // Use in API requests
   const response = await fetch('http://localhost:5000/api/firebase/me', {
     headers: {
       'Authorization': `Bearer ${idToken}`
     }
   });
   ```

## Troubleshooting

### Firebase Admin SDK not initialized
- Check if `serviceAccountKey.json` exists in the backend folder
- Verify environment variables are set correctly
- Ensure Firebase project ID matches your configuration

### Authentication errors
- Verify the service account has the necessary permissions
- Check if the Firebase project is properly configured
- Ensure the client is sending valid Firebase ID tokens

### CORS issues
- Make sure your Firebase project's authorized domains include your development URLs
- Check the CORS configuration in `server.js`

## Security Best Practices

1. **Never expose service account keys** in client-side code
2. **Use environment variables** in production
3. **Implement proper role-based access control**
4. **Validate all user inputs** on the server side
5. **Use HTTPS** in production
6. **Regularly rotate** service account keys

## Next Steps

1. Integrate Firebase authentication with your existing user model
2. Implement push notifications for ride updates
3. Add Firebase Firestore for real-time data synchronization
4. Set up Firebase Cloud Storage for file uploads
5. Implement Firebase Analytics for user behavior tracking
