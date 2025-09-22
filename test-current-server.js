const axios = require('axios');

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function testCurrentServer() {
  try {
    console.log('🧪 Testing current server...');
    
    // Test 1: Check if there are any drivers in the database
    console.log('\n1. Testing debug-drivers endpoint...');
    try {
      const debugResponse = await axios.get(`${BASE_URL}/api/ride-requests/debug-drivers`, {
        headers: { 
          Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZDA0NTM2Y2NiNTU2OGRjNGRkNjNiNyIsImVtYWlsIjoic2FtcmFuQGdhbmR1LmNvbSIsInVzZXJUeXBlIjoiZHJpdmVyIiwiaWF0IjoxNzU4NDc5Njg1LCJleHAiOjE3NTkwODQ0ODV9.GAahrUCX5PnFZMBHzz4cerUzR3Igy3j-S6zXL3sIHKU'
        }
      });
      
      console.log('✅ Debug drivers response:', debugResponse.data);
    } catch (error) {
      console.log('❌ Debug drivers failed:', error.response?.data || error.message);
    }
    
    // Test 2: Check driver registration for existing user
    console.log('\n2. Checking driver registration for existing user...');
    try {
      const checkResponse = await axios.get(`${BASE_URL}/api/drivers/check-registration`, {
        headers: { 
          Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZDA0NTM2Y2NiNTU2OGRjNGRkNjNiNyIsImVtYWlsIjoic2FtcmFuQGdhbmR1LmNvbSIsInVzZXJUeXBlIjoiZHJpdmVyIiwiaWF0IjoxNzU4NDc5Njg1LCJleHAiOjE3NTkwODQ0ODV9.GAahrUCX5PnFZMBHzz4cerUzR3Igy3j-S6zXL3sIHKU'
        }
      });
      
      console.log('✅ Driver registration status:', checkResponse.data);
    } catch (error) {
      console.log('❌ Driver registration check failed:', error.response?.data || error.message);
    }
    
    // Test 3: Try to update driver location
    console.log('\n3. Trying to update driver location...');
    try {
      const locationResponse = await axios.post(`${BASE_URL}/api/drivers/location`, {
        latitude: 35.9208,
        longitude: 74.3144
      }, {
        headers: { 
          Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZDA0NTM2Y2NiNTU2OGRjNGRkNjNiNyIsImVtYWlsIjoic2FtcmFuQGdhbmR1LmNvbSIsInVzZXJUeXBlIjoiZHJpdmVyIiwiaWF0IjoxNzU4NDc5Njg1LCJleHAiOjE3NTkwODQ0ODV9.GAahrUCX5PnFZMBHzz4cerUzR3Igy3j-S6zXL3sIHKU'
        }
      });
      
      console.log('✅ Driver location updated:', locationResponse.data);
    } catch (error) {
      console.log('❌ Driver location update failed:', error.response?.data || error.message);
    }
    
    // Test 4: Check available ride requests
    console.log('\n4. Checking available ride requests...');
    try {
      const requestsResponse = await axios.get(`${BASE_URL}/api/ride-requests/available-simple`, {
        headers: { 
          Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZDA0NTM2Y2NiNTU2OGRjNGRkNjNiNyIsImVtYWlsIjoic2FtcmFuQGdhbmR1LmNvbSIsInVzZXJUeXBlIjoiZHJpdmVyIiwiaWF0IjoxNzU4NDc5Njg1LCJleHAiOjE3NTkwODQ0ODV9.GAahrUCX5PnFZMBHzz4cerUzR3Igy3j-S6zXL3sIHKU'
        }
      });
      
      console.log('✅ Available ride requests:', requestsResponse.data.rideRequests.length);
    } catch (error) {
      console.log('❌ Available ride requests failed:', error.response?.data || error.message);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testCurrentServer();

