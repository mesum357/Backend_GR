const os = require('os');
const { spawn } = require('child_process');

// Function to get network IP address
function getNetworkIP() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  
  for (const name of Object.keys(interfaces)) {
    for (const interface of interfaces[name]) {
      if (interface.family === 'IPv4' && !interface.internal) {
        ips.push({
          interface: name,
          ip: interface.address,
          netmask: interface.netmask
        });
      }
    }
  }
  
  return ips;
}

// Function to start the server
function startServer() {
  console.log('🚀 Starting local backend server...\n');
  
  // Get network IPs
  const networkIPs = getNetworkIP();
  
  console.log('📡 Available network interfaces:');
  networkIPs.forEach(({ interface, ip, netmask }) => {
    console.log(`  - ${interface}: ${ip} (${netmask})`);
  });
  
  if (networkIPs.length === 0) {
    console.log('❌ No network interfaces found. Using localhost only.');
  } else {
    console.log(`\n✅ Recommended IP for mobile testing: ${networkIPs[0].ip}`);
    console.log('📱 Update your frontend config to use this IP address.');
  }
  
  console.log('\n🔧 Starting server on all interfaces (0.0.0.0:8080)...');
  console.log('📋 Server will be accessible at:');
  console.log('  - Local: http://localhost:8080');
  console.log('  - Network: http://[YOUR_IP]:8080');
  console.log('  - All devices on same network: http://[YOUR_IP]:8080');
  
  // Start the server
  const server = spawn('node', ['server.js'], {
    stdio: 'inherit',
    cwd: __dirname
  });
  
  server.on('error', (error) => {
    console.error('❌ Failed to start server:', error);
  });
  
  server.on('close', (code) => {
    console.log(`\n🔌 Server process exited with code ${code}`);
  });
  
  // Handle process termination
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    server.kill('SIGINT');
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down server...');
    server.kill('SIGTERM');
    process.exit(0);
  });
}

// Check if MongoDB is running
function checkMongoDB() {
  const mongoose = require('mongoose');
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/tourist_app';
  
  console.log('🔍 Checking MongoDB connection...');
  
  mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log('✅ MongoDB connected successfully');
    mongoose.disconnect();
    startServer();
  })
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    console.log('\n💡 Please make sure MongoDB is running:');
    console.log('   - Windows: Start MongoDB service or run "mongod"');
    console.log('   - macOS: brew services start mongodb-community');
    console.log('   - Linux: sudo systemctl start mongod');
    console.log('\n🔄 Retrying in 5 seconds...');
    setTimeout(checkMongoDB, 5000);
  });
}

// Start the process
checkMongoDB();

