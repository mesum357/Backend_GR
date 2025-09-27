const jwt = require('jsonwebtoken');

// The JWT token from the logs
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZDA0NTM2Y2NiNTU2OGRjNGRkNjNiNyIsImVtYWlsIjoic2FtcmFuQGdhbmR1LmNvbSIsInVzZXJUeXBlIjoiZHJpdmVyIiwiaWF0IjoxNzU4NDc5Njg1LCJleHAiOjE3NTkwODQ0ODV9.GAahrUCX5PnFZMBHzz4cerUzR3Igy3j-S6zXL3sIHKU';

console.log('🔍 Debugging JWT Token...\n');

try {
  // Decode without verification to see the payload
  const decoded = jwt.decode(token);
  console.log('📄 Token payload:', JSON.stringify(decoded, null, 2));
  
  // Check if token is expired
  const now = Math.floor(Date.now() / 1000);
  const exp = decoded.exp;
  const iat = decoded.iat;
  
  console.log('\n⏰ Token timing:');
  console.log('  - Issued at (iat):', new Date(iat * 1000).toISOString());
  console.log('  - Expires at (exp):', new Date(exp * 1000).toISOString());
  console.log('  - Current time:', new Date(now * 1000).toISOString());
  console.log('  - Is expired:', now > exp);
  console.log('  - Time until expiry:', Math.floor((exp - now) / 3600), 'hours');
  
  // Try to verify with different secrets
  const secrets = [
    'your-jwt-secret',
    process.env.JWT_SECRET,
    'default-secret',
    'secret'
  ];
  
  console.log('\n🔐 Testing JWT verification with different secrets:');
  for (const secret of secrets) {
    try {
      const verified = jwt.verify(token, secret);
      console.log(`  ✅ Verified with secret: "${secret}"`);
      console.log('  📄 Verified payload:', JSON.stringify(verified, null, 2));
      break;
    } catch (error) {
      console.log(`  ❌ Failed with secret: "${secret}" - ${error.message}`);
    }
  }
  
} catch (error) {
  console.error('❌ Error decoding token:', error.message);
}

// Check environment variables
console.log('\n🌍 Environment variables:');
console.log('  - JWT_SECRET:', process.env.JWT_SECRET || 'NOT SET');
console.log('  - NODE_ENV:', process.env.NODE_ENV || 'NOT SET');

