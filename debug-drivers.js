const Driver = require('./models/Driver');
const mongoose = require('mongoose');

async function checkDrivers() {
  try {
    await mongoose.connect('mongodb+srv://mesum:mesum123@cluster0.8jqjq.mongodb.net/tourist?retryWrites=true&w=majority');
    
    console.log('🔍 Checking all drivers in database...');
    const allDrivers = await Driver.find({}).populate('user', 'firstName lastName email');
    
    console.log('Total drivers found:', allDrivers.length);
    
    allDrivers.forEach((driver, index) => {
      console.log(`Driver ${index + 1}:`, {
        id: driver._id,
        userId: driver.user?._id,
        userName: driver.user ? `${driver.user.firstName} ${driver.user.lastName}` : 'No user',
        email: driver.user?.email,
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable,
        isApproved: driver.isApproved,
        isVerified: driver.isVerified,
        hasLocation: !!driver.currentLocation,
        coordinates: driver.currentLocation?.coordinates,
        lastActive: driver.lastActive
      });
    });
    
    // Check for the specific driver from the logs
    const samranDriver = await Driver.findOne({ user: '68d04536ccb5568dc4dd63b7' }).populate('user', 'firstName lastName email');
    console.log('\n🔍 Samran driver specifically:', samranDriver);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkDrivers();
