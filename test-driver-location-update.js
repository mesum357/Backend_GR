const fetch = require('node-fetch').default;

const BASE_URL = 'http://192.168.137.1:8080';

async function testDriverLocationUpdate() {
  try {
    console.log('🧪 Testing driver location update...');
    
    // Step 1: Login as driver
    console.log('\n1. Logging in as driver...');
    const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'testdriver@example.com',
        password: 'password123',
        expectedUserType: 'driver'
      })
    });
    
    const loginData = await loginResponse.json();
    console.log('✅ Driver login response:', loginData);
    
    if (!loginResponse.ok) {
      throw new Error('Driver login failed');
    }
    
    const token = loginData.token;
    
    // Step 2: Check if driver has a Driver profile
    console.log('\n2. Checking driver profile...');
    const profileResponse = await fetch(`${BASE_URL}/api/drivers/check-registration`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      }
    });
    
    const profileData = await profileResponse.json();
    console.log('📊 Driver profile check:', profileData);
    
    if (!profileData.driverProfile || !profileData.driverProfile._id) {
      console.log('❌ Driver does not have a proper Driver profile. Need to register first.');
      
      // Step 3: Register as driver
      console.log('\n3. Registering as driver...');
      const registerResponse = await fetch(`${BASE_URL}/api/drivers/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          vehicleInfo: {
            make: 'Toyota',
            model: 'Corolla',
            year: 2020,
            color: 'White',
            plateNumber: 'GIL-123',
            vehicleType: 'car'
          },
          licenseNumber: 'LIC123456',
          licenseExpiry: '2026-12-31',
          insuranceNumber: 'INS123456',
          insuranceExpiry: '2026-12-31',
          preferredAreas: ['Gilgit City'],
          maxDistance: 50,
          minFare: 50,
          maxFare: 2000
        })
      });
      
      const registerData = await registerResponse.json();
      console.log('📊 Driver registration response:', registerData);
      
      if (!registerResponse.ok) {
        console.log('❌ Driver registration failed:', registerData);
        return;
      }
      
      console.log('✅ Driver registered successfully');
    }
    
    // Step 4: Test location update
    console.log('\n4. Testing location update...');
    const locationResponse = await fetch(`${BASE_URL}/api/drivers/location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        latitude: 35.9208,
        longitude: 74.3144
      })
    });
    
    console.log('📊 Location update response status:', locationResponse.status);
    
    if (locationResponse.ok) {
      const locationData = await locationResponse.json();
      console.log('✅ Location update successful:', locationData);
    } else {
      const errorData = await locationResponse.json();
      console.log('❌ Location update failed:', errorData);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testDriverLocationUpdate();
