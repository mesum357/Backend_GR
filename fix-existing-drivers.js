const axios = require('axios');

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function fixExistingDrivers() {
  try {
    console.log('🔧 Fixing existing drivers...');
    
    // Get all drivers
    const debugResponse = await axios.get(`${BASE_URL}/api/ride-requests/debug-drivers`, {
      headers: { 
        Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZDA0NTM2Y2NiNTU2OGRjNGRkNjNiNyIsImVtYWlsIjoic2FtcmFuQGdhbmR1LmNvbSIsInVzZXJUeXBlIjoiZHJpdmVyIiwiaWF0IjoxNzU4NDc5Njg1LCJleHAiOjE3NTkwODQ0ODV9.GAahrUCX5PnFZMBHzz4cerUzR3Igy3j-S6zXL3sIHKU'
      }
    });
    
    const drivers = debugResponse.data.allDrivers;
    console.log(`Found ${drivers.length} drivers to fix`);
    
    // For now, let's just test with Samran's driver
    const samranDriver = drivers.find(d => d.userName === 'Samran Gandu');
    if (samranDriver) {
      console.log('🔧 Found Samran driver:', samranDriver.id);
      
      // We can't directly update the database from here, but we can test the ride request flow
      // Let's create a test ride request and see what happens
      console.log('\n🧪 Creating test ride request...');
      
      const rideRequestResponse = await axios.post(`${BASE_URL}/api/ride-requests/request-ride`, {
        pickup: {
          latitude: 35.9208,
          longitude: 74.3144,
          address: 'Gilgit City Center'
        },
        destination: {
          latitude: 35.9308,
          longitude: 74.3244,
          address: 'Gilgit Airport'
        },
        offeredFare: 100,
        radiusMeters: 1200,
        paymentMethod: 'cash',
        vehicleType: 'any',
        notes: 'Test ride request'
      }, {
        headers: { 
          Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4YzlhNmU3ZDRkNzYwOTdiMzI2NDQwNyIsImVtYWlsIjoiYXRoYXJAZ21haWwuY29tIiwidXNlclR5cGUiOiJyaWRlciIsImlhdCI6MTc1ODQ3NjcxMiwiZXhwIjoxNzU5MDgxNTEyfQ.ZcNFii6Afj2zYWLnPsJAi-WUIPHv5Myl5zUoHfJ47bA'
        }
      });
      
      console.log('✅ Ride request created:', rideRequestResponse.data);
      
      // Now check if Samran can see the request
      console.log('\n🔍 Checking if Samran can see the request...');
      const samranRequestsResponse = await axios.get(`${BASE_URL}/api/ride-requests/available-simple`, {
        headers: { 
          Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZDA0NTM2Y2NiNTU2OGRjNGRkNjNiNyIsImVtYWlsIjoic2FtcmFuQGdhbmR1LmNvbSIsInVzZXJUeXBlIjoiZHJpdmVyIiwiaWF0IjoxNzU4NDc5Njg1LCJleHAiOjE3NTkwODQ0ODV9.GAahrUCX5PnFZMBHzz4cerUzR3Igy3j-S6zXL3sIHKU'
        }
      });
      
      console.log('✅ Samran sees requests:', samranRequestsResponse.data.rideRequests.length);
      
    } else {
      console.log('❌ Samran driver not found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

fixExistingDrivers();

