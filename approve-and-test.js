const axios = require('axios');

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function approveAndTest() {
  try {
    console.log('🔧 Approving all drivers and testing...');
    
    // Step 1: Approve all drivers
    console.log('\n1. Approving all drivers...');
    try {
      const approveResponse = await axios.post(`${BASE_URL}/api/drivers/approve-all`, {}, {
        headers: { 
          Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZDA0NTM2Y2NiNTU2OGRjNGRkNjNiNyIsImVtYWlsIjoic2FtcmFuQGdhbmR1LmNvbSIsInVzZXJUeXBlIjoiZHJpdmVyIiwiaWF0IjoxNzU4NDc5Njg1LCJleHAiOjE3NTkwODQ0ODV9.GAahrUCX5PnFZMBHzz4cerUzR3Igy3j-S6zXL3sIHKU'
        }
      });
      
      console.log('✅ Drivers approved:', approveResponse.data);
    } catch (error) {
      console.log('❌ Approve drivers failed:', error.response?.data || error.message);
      return;
    }
    
    // Step 2: Check driver status
    console.log('\n2. Checking driver status...');
    try {
      const debugResponse = await axios.get(`${BASE_URL}/api/ride-requests/debug-drivers`, {
        headers: { 
          Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZDA0NTM2Y2NiNTU2OGRjNGRkNjNiNyIsImVtYWlsIjoic2FtcmFuQGdhbmR1LmNvbSIsInVzZXJUeXBlIjoiZHJpdmVyIiwiaWF0IjoxNzU4NDc5Njg1LCJleHAiOjE3NTkwODQ0ODV9.GAahrUCX5PnFZMBHzz4cerUzR3Igy3j-S6zXL3sIHKU'
        }
      });
      
      console.log('✅ Driver status:', {
        totalDrivers: debugResponse.data.totalDrivers,
        approvedDrivers: debugResponse.data.approvedDrivers,
        onlineDrivers: debugResponse.data.onlineDrivers,
        availableDrivers: debugResponse.data.availableDrivers
      });
    } catch (error) {
      console.log('❌ Debug drivers failed:', error.response?.data || error.message);
    }
    
    // Step 3: Create a test ride request
    console.log('\n3. Creating test ride request...');
    try {
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
        notes: 'Test ride request after approval'
      }, {
        headers: { 
          Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4YzlhNmU3ZDRkNzYwOTdiMzI2NDQwNyIsImVtYWlsIjoiYXRoYXJAZ21haWwuY29tIiwidXNlclR5cGUiOiJyaWRlciIsImlhdCI6MTc1ODQ3NjcxMiwiZXhwIjoxNzU5MDgxNTEyfQ.ZcNFii6Afj2zYWLnPsJAi-WUIPHv5Myl5zUoHfJ47bA'
        }
      });
      
      console.log('✅ Ride request created:', rideRequestResponse.data);
    } catch (error) {
      console.log('❌ Ride request creation failed:', error.response?.data || error.message);
    }
    
    // Step 4: Check if drivers can see the request
    console.log('\n4. Checking if drivers can see the request...');
    try {
      const samranRequestsResponse = await axios.get(`${BASE_URL}/api/ride-requests/available-simple`, {
        headers: { 
          Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZDA0NTM2Y2NiNTU2OGRjNGRkNjNiNyIsImVtYWlsIjoic2FtcmFuQGdhbmR1LmNvbSIsInVzZXJUeXBlIjoiZHJpdmVyIiwiaWF0IjoxNzU4NDc5Njg1LCJleHAiOjE3NTkwODQ0ODV9.GAahrUCX5PnFZMBHzz4cerUzR3Igy3j-S6zXL3sIHKU'
        }
      });
      
      console.log('✅ Samran sees requests:', samranRequestsResponse.data.rideRequests.length);
      if (samranRequestsResponse.data.rideRequests.length > 0) {
        console.log('🎉 SUCCESS! Drivers can now see ride requests!');
      }
    } catch (error) {
      console.log('❌ Check requests failed:', error.response?.data || error.message);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

approveAndTest();
