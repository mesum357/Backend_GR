const axios = require('axios');

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function debugDriverLocation() {
  try {
    console.log('🔍 Debugging driver location update...');
    
    // Step 1: Login as driver
    console.log('\n1. Logging in as driver...');
    const driverLoginResponse = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: 'samran@gandu.com',
      password: '123456',
      expectedUserType: 'driver'
    });
    
    console.log('✅ Driver logged in:', driverLoginResponse.data.user.email);
    const driverToken = driverLoginResponse.data.token;
    
    // Step 2: Check driver registration status
    console.log('\n2. Checking driver registration...');
    const checkResponse = await axios.get(`${BASE_URL}/api/drivers/check-registration`, {
      headers: { Authorization: `Bearer ${driverToken}` }
    });
    
    console.log('✅ Driver registration status:', checkResponse.data);
    
    // Step 3: Try to update driver location and see the exact error
    console.log('\n3. Attempting driver location update...');
    try {
      const locationResponse = await axios.post(`${BASE_URL}/api/drivers/location`, {
        latitude: 35.9208,
        longitude: 74.3144
      }, {
        headers: { Authorization: `Bearer ${driverToken}` }
      });
      
      console.log('✅ Driver location updated successfully:', locationResponse.data);
    } catch (error) {
      console.log('❌ Driver location update failed:');
      console.log('Status:', error.response?.status);
      console.log('Error:', error.response?.data);
      console.log('Full error:', error.message);
    }
    
    // Step 4: Check if driver profile exists in database
    console.log('\n4. Checking debug drivers...');
    try {
      const debugResponse = await axios.get(`${BASE_URL}/api/ride-requests/debug-drivers`, {
        headers: { Authorization: `Bearer ${driverToken}` }
      });
      
      console.log('✅ Debug drivers info:', {
        totalDrivers: debugResponse.data.totalDrivers,
        onlineDrivers: debugResponse.data.onlineDrivers,
        availableDrivers: debugResponse.data.availableDrivers,
        approvedDrivers: debugResponse.data.approvedDrivers,
        driversWithLocation: debugResponse.data.driversWithLocation
      });
      
      // Check if our specific driver is in the list
      const ourDriver = debugResponse.data.allDrivers.find(d => d.userId === '68d04536ccb5568dc4dd63b7');
      if (ourDriver) {
        console.log('✅ Our driver found in debug list:', ourDriver);
      } else {
        console.log('❌ Our driver NOT found in debug list');
      }
    } catch (error) {
      console.log('❌ Could not get debug drivers:', error.response?.data || error.message);
    }
    
    // Step 5: Try to create driver profile if it doesn't exist
    console.log('\n5. Attempting to create driver profile...');
    try {
      const createProfileResponse = await axios.post(`${BASE_URL}/api/drivers/create-profile`, {
        vehicleInfo: {
          make: 'Toyota',
          model: 'Corolla',
          year: 2020,
          color: 'White',
          plateNumber: 'TEST001',
          vehicleType: 'car'
        },
        licenseNumber: 'LIC123',
        licenseExpiry: '2026-12-31T00:00:00.000Z',
        insuranceNumber: 'INS123',
        insuranceExpiry: '2026-12-31T00:00:00.000Z'
      }, {
        headers: { Authorization: `Bearer ${driverToken}` }
      });
      
      console.log('✅ Driver profile created:', createProfileResponse.data);
    } catch (error) {
      console.log('❌ Could not create driver profile:', error.response?.data || error.message);
    }
    
    // Step 6: Try location update again after profile creation
    console.log('\n6. Attempting driver location update again...');
    try {
      const locationResponse2 = await axios.post(`${BASE_URL}/api/drivers/location`, {
        latitude: 35.9208,
        longitude: 74.3144
      }, {
        headers: { Authorization: `Bearer ${driverToken}` }
      });
      
      console.log('✅ Driver location updated successfully (2nd attempt):', locationResponse2.data);
    } catch (error) {
      console.log('❌ Driver location update failed (2nd attempt):');
      console.log('Status:', error.response?.status);
      console.log('Error:', error.response?.data);
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.response?.data || error.message);
  }
}

debugDriverLocation();
