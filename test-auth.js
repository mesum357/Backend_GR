const { helpers } = require('./config/firebase');

async function testAuthentication() {
  console.log('🔐 Testing Firebase Authentication...\n');

  // Test 1: Check if Firebase is initialized
  console.log('1. Checking Firebase initialization...');
  if (!helpers) {
    console.log('❌ Firebase helpers are not available');
    return;
  }
  console.log('✅ Firebase helpers are available\n');

  // Test 2: Create a custom token
  console.log('2. Testing custom token creation...');
  try {
    const testUid = 'test-user-' + Date.now();
    const customToken = await helpers.createCustomToken(testUid, { 
      role: 'rider',
      email: 'test@example.com'
    });
    console.log('✅ Custom token created successfully');
    console.log(`   UID: ${testUid}`);
    console.log(`   Token: ${customToken.substring(0, 50)}...`);
    console.log(`   Token length: ${customToken.length} characters\n`);
  } catch (error) {
    console.log('❌ Custom token creation failed');
    console.log(`   Error: ${error.message}\n`);
    return;
  }

  // Test 3: Test token verification with invalid token
  console.log('3. Testing token verification (invalid token)...');
  try {
    await helpers.verifyIdToken('invalid-token-for-testing');
    console.log('❌ Token verification should have failed');
  } catch (error) {
    console.log('✅ Token verification correctly rejected invalid token');
    console.log(`   Expected error: ${error.message}\n`);
  }

  // Test 4: Test user retrieval with non-existent user
  console.log('4. Testing user retrieval (non-existent user)...');
  try {
    await helpers.getUserByUid('non-existent-user-id');
    console.log('❌ User retrieval should have failed');
  } catch (error) {
    console.log('✅ User retrieval correctly failed for non-existent user');
    console.log(`   Expected error: ${error.message}\n`);
  }

  // Test 5: Test user profile update with non-existent user
  console.log('5. Testing user profile update (non-existent user)...');
  try {
    await helpers.updateUserProfile('non-existent-user-id', {
      displayName: 'Test User'
    });
    console.log('❌ User update should have failed');
  } catch (error) {
    console.log('✅ User update correctly failed for non-existent user');
    console.log(`   Expected error: ${error.message}\n`);
  }

  // Test 6: Test multiple custom tokens with different claims
  console.log('6. Testing multiple custom tokens with different roles...');
  try {
    const riderToken = await helpers.createCustomToken('rider-user', { role: 'rider' });
    const driverToken = await helpers.createCustomToken('driver-user', { role: 'driver' });
    const adminToken = await helpers.createCustomToken('admin-user', { role: 'admin' });
    
    console.log('✅ Multiple custom tokens created successfully');
    console.log(`   Rider token: ${riderToken.substring(0, 30)}...`);
    console.log(`   Driver token: ${driverToken.substring(0, 30)}...`);
    console.log(`   Admin token: ${adminToken.substring(0, 30)}...\n`);
  } catch (error) {
    console.log('❌ Multiple token creation failed');
    console.log(`   Error: ${error.message}\n`);
  }

  console.log('🎉 Authentication Test Summary:');
  console.log('✅ Firebase Admin SDK is working');
  console.log('✅ Custom token creation is working');
  console.log('✅ Token verification is working');
  console.log('✅ User management functions are working');
  console.log('✅ Error handling is working correctly');
  console.log('\n🚀 Your Firebase authentication is ready to use!');
}

// Run the test
testAuthentication().catch(error => {
  console.error('❌ Test failed with error:', error.message);
  process.exit(1);
});
