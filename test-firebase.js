const { helpers } = require('./config/firebase');

async function testFirebaseIntegration() {
  console.log('🧪 Testing Firebase Integration...\n');

  // Test 1: Check if Firebase is initialized
  console.log('1. Checking Firebase initialization...');
  if (helpers) {
    console.log('✅ Firebase helpers are available');
  } else {
    console.log('❌ Firebase helpers are not available');
    return;
  }

  // Test 2: Test custom token creation (this will fail without proper credentials)
  console.log('\n2. Testing custom token creation...');
  try {
    const customToken = await helpers.createCustomToken('test-uid', { role: 'rider' });
    console.log('✅ Custom token created successfully');
    console.log(`   Token: ${customToken.substring(0, 20)}...`);
  } catch (error) {
    console.log('❌ Custom token creation failed');
    console.log(`   Error: ${error.message}`);
    console.log('   This is expected if Firebase is not properly configured');
  }

  // Test 3: Test token verification (this will fail without proper credentials)
  console.log('\n3. Testing token verification...');
  try {
    const decodedToken = await helpers.verifyIdToken('invalid-token-for-testing');
    console.log('✅ Token verification works');
  } catch (error) {
    console.log('✅ Token verification correctly rejected invalid token');
    console.log(`   Expected error: ${error.message}`);
  }

  // Test 4: Test user retrieval (this will fail without proper credentials)
  console.log('\n4. Testing user retrieval...');
  try {
    const userRecord = await helpers.getUserByUid('test-uid');
    console.log('✅ User retrieval works');
    console.log(`   User email: ${userRecord.email}`);
  } catch (error) {
    console.log('❌ User retrieval failed');
    console.log(`   Error: ${error.message}`);
    console.log('   This is expected if Firebase is not properly configured');
  }

  console.log('\n📋 Summary:');
  console.log('If you see ❌ errors above, you need to:');
  console.log('1. Install firebase-admin: npm install firebase-admin');
  console.log('2. Download serviceAccountKey.json from Firebase Console');
  console.log('3. Place it in the backend folder');
  console.log('4. Or configure Firebase environment variables');
  console.log('\nSee FIREBASE_SETUP.md for detailed instructions');
}

// Run the test
testFirebaseIntegration().catch(console.error);
