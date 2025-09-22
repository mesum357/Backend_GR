const Driver = require('./models/Driver');
const User = require('./models/User');
const mongoose = require('mongoose');

async function fixDriver() {
  try {
    // Connect to MongoDB
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/tourist_app';
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('🔍 Connected to MongoDB');
    
    // Find the user who registered as driver
    const userId = '68d04536ccb5568dc4dd63b7'; // Samran's user ID from logs
    const user = await User.findById(userId);
    
    if (!user) {
      console.log('❌ User not found');
      return;
    }
    
    console.log('🔍 Found user:', {
      id: user._id,
      email: user.email,
      userType: user.userType
    });
    
    // Check if driver profile already exists
    let driver = await Driver.findOne({ user: userId });
    
    if (driver) {
      console.log('🔍 Driver profile already exists:', driver._id);
    } else {
      console.log('🔍 Creating driver profile...');
      
      // Create driver profile
      const driverData = {
        user: userId,
        vehicleInfo: {
          make: 'Test',
          model: 'Car',
          year: 2020,
          color: 'White',
          plateNumber: 'TEST123',
          vehicleType: 'car'
        },
        licenseNumber: 'TEST123',
        licenseExpiry: new Date('2026-12-31'),
        insuranceNumber: 'INS123',
        insuranceExpiry: new Date('2026-12-31'),
        currentLocation: {
          type: 'Point',
          coordinates: [74.3504, 35.9109] // Current location from logs
        },
        isOnline: true,
        isAvailable: true,
        isApproved: true
      };
      
      driver = await Driver.createDriverProfile(userId, driverData);
      console.log('✅ Driver profile created:', driver._id);
    }
    
    // Update driver location
    await driver.updateLocation(35.9109, 74.3504);
    console.log('✅ Driver location updated');
    
    // Verify driver status
    const updatedDriver = await Driver.findById(driver._id);
    console.log('🔍 Final driver status:', {
      id: updatedDriver._id,
      isOnline: updatedDriver.isOnline,
      isAvailable: updatedDriver.isAvailable,
      isApproved: updatedDriver.isApproved,
      hasLocation: !!updatedDriver.currentLocation,
      coordinates: updatedDriver.currentLocation?.coordinates
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixDriver();

