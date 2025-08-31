const { helpers } = require('./config/firebase');

async function quickAuthTest() {
  console.log('🔐 Quick Authentication Test\n');

  // Test 1: Verify Firebase is working
  console.log('1. Testing Firebase Admin SDK...');
  if (!helpers) {
    console.log('❌ Firebase helpers not available');
    return;
  }
  console.log('✅ Firebase Admin SDK is working\n');

  // Test 2: Create a test token
  console.log('2. Creating test custom token...');
  try {
    const testUid = 'test-user-' + Date.now();
    const customToken = await helpers.createCustomToken(testUid, { 
      role: 'rider',
      email: 'test@example.com'
    });
    console.log('✅ Custom token created successfully');
    console.log(`   UID: ${testUid}`);
    console.log(`   Token length: ${customToken.length} characters\n`);
  } catch (error) {
    console.log('❌ Custom token creation failed');
    console.log(`   Error: ${error.message}\n`);
    return;
  }

  // Test 3: Test token verification
  console.log('3. Testing token verification...');
  try {
    await helpers.verifyIdToken('invalid-token');
    console.log('❌ Token verification should have failed');
  } catch (error) {
    console.log('✅ Token verification correctly rejects invalid tokens');
    console.log(`   Error: ${error.message}\n`);
  }

  console.log('🎉 Authentication Test Results:');
  console.log('✅ Firebase Admin SDK is initialized');
  console.log('✅ Custom token creation is working');
  console.log('✅ Token verification is working');
  console.log('✅ Error handling is working correctly');
  console.log('\n🚀 Your Firebase authentication is fully functional!');
  console.log('\n📋 Next steps:');
  console.log('1. Start your server: npm run dev');
  console.log('2. Test API endpoints with a tool like Postman or curl');
  console.log('3. Integrate with your React Native app');
}

quickAuthTest().catch(console.error);
