const fetch = require('node-fetch').default;

const BASE_URL = 'https://backend-gr-x2ki.onrender.com';

async function testFixes() {
  try {
    console.log('🧪 Testing all fixes...\n');
    
    // Step 1: Login as driver
    console.log('1. Logging in as driver...');
    const driverLoginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'samran@gandu.com',
        password: 'password123',
        expectedUserType: 'driver'
      })
    });
    
    const driverLoginData = await driverLoginResponse.json();
    console.log('✅ Driver login response:', driverLoginData);
    
    if (!driverLoginResponse.ok) {
      throw new Error('Driver login failed');
    }
    
    const driverToken = driverLoginData.token;
    
    // Step 2: Test check-registration endpoint
    console.log('\n2. Testing check-registration endpoint...');
    const checkRegResponse = await fetch(`${BASE_URL}/api/drivers/check-registration`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${driverToken}`,
      }
    });
    
    console.log('📊 Check-registration response status:', checkRegResponse.status);
    
    if (checkRegResponse.ok) {
      const checkRegData = await checkRegResponse.json();
      console.log('✅ Check-registration data:', checkRegData);
      
      // Check if all fields are properly defined
      const hasUndefined = Object.values(checkRegData).some(value => value === undefined);
      if (hasUndefined) {
        console.log('❌ Still has undefined values:', checkRegData);
      } else {
        console.log('✅ All values are properly defined!');
      }
    } else {
      const errorData = await checkRegResponse.json();
      console.log('❌ Check-registration error:', errorData);
    }
    
    // Step 3: Test driver location update
    console.log('\n3. Testing driver location update...');
    const locationResponse = await fetch(`${BASE_URL}/api/drivers/location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${driverToken}`,
      },
      body: JSON.stringify({
        latitude: 35.9108999,
        longitude: 74.350483
      })
    });
    
    console.log('📊 Location update response status:', locationResponse.status);
    
    if (locationResponse.ok) {
      const locationData = await locationResponse.json();
      console.log('✅ Location update successful:', locationData);
    } else {
      const errorData = await locationResponse.json();
      console.log('❌ Location update error:', errorData);
    }
    
    // Step 4: Test ride requests endpoint
    console.log('\n4. Testing ride requests endpoint...');
    const rideRequestsResponse = await fetch(`${BASE_URL}/api/ride-requests/available-simple`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${driverToken}`,
      }
    });
    
    console.log('📊 Ride requests response status:', rideRequestsResponse.status);
    
    if (rideRequestsResponse.ok) {
      const rideRequestsData = await rideRequestsResponse.json();
      console.log('✅ Ride requests data:', rideRequestsData);
      console.log(`📊 Found ${rideRequestsData.length} ride requests`);
    } else {
      const errorData = await rideRequestsResponse.json();
      console.log('❌ Ride requests error:', errorData);
    }
    
    // Step 5: Login as rider and create a ride request
    console.log('\n5. Testing ride request creation...');
    const riderLoginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'athar@gmail.com',
        password: 'password123',
        expectedUserType: 'rider'
      })
    });
    
    const riderLoginData = await riderLoginResponse.json();
    console.log('✅ Rider login response:', riderLoginData);
    
    if (riderLoginResponse.ok) {
      const riderToken = riderLoginData.token;
      
      // Create a ride request
      const rideRequestResponse = await fetch(`${BASE_URL}/api/ride-requests/create-simple`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${riderToken}`,
        },
        body: JSON.stringify({
          pickup: {
            latitude: 35.9108999,
            longitude: 74.350483,
            address: 'Test Pickup Location'
          },
          destination: {
            latitude: 35.92121449406011,
            longitude: 74.34872752055526,
            address: 'Test Destination'
          },
          offeredFare: 150,
          paymentMethod: 'cash',
          vehicleType: 'any',
          notes: 'Test ride request'
        })
      });
      
      console.log('📊 Ride request creation status:', rideRequestResponse.status);
      
      if (rideRequestResponse.ok) {
        const rideRequestData = await rideRequestResponse.json();
        console.log('✅ Ride request created:', rideRequestData);
        
        // Wait a moment and check if driver can see the request
        console.log('\n6. Checking if driver can see the new request...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const updatedRideRequestsResponse = await fetch(`${BASE_URL}/api/ride-requests/available-simple`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${driverToken}`,
          }
        });
        
        if (updatedRideRequestsResponse.ok) {
          const updatedRideRequestsData = await updatedRideRequestsResponse.json();
          console.log('✅ Updated ride requests data:', updatedRideRequestsData);
          console.log(`📊 Driver can now see ${updatedRideRequestsData.length} ride requests`);
          
          if (updatedRideRequestsData.length > 0) {
            console.log('🎉 SUCCESS: Driver can see ride requests!');
          } else {
            console.log('❌ Driver still cannot see ride requests');
          }
        }
      } else {
        const errorData = await rideRequestResponse.json();
        console.log('❌ Ride request creation error:', errorData);
      }
    }
    
    console.log('\n✅ Test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testFixes();
