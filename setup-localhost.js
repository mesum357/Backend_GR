const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

console.log('🚀 Setting up localhost backend for all IPs...\n');

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

// Function to update frontend config
function updateFrontendConfig(networkIP) {
  const frontendConfigPath = path.join(__dirname, '..', 'src', 'config', 'api.ts');
  
  try {
    // Read the current config
    let configContent = fs.readFileSync(frontendConfigPath, 'utf8');
    
    // Update the development baseURL
    const updatedConfig = configContent.replace(
      /baseURL: 'http:\/\/[^']*', \/\/ Local backend - replace with your actual IP/,
      `baseURL: 'http://${networkIP}:8080', // Local backend - auto-updated`
    );
    
    // Write the updated config
    fs.writeFileSync(frontendConfigPath, updatedConfig);
    
    console.log('✅ Frontend config updated successfully!');
    console.log(`📱 Frontend will now connect to: http://${networkIP}:8080`);
    
    return true;
  } catch (error) {
    console.error('❌ Failed to update frontend config:', error.message);
    return false;
  }
}

// Function to check if MongoDB is running
function checkMongoDB() {
  return new Promise((resolve, reject) => {
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
      resolve(true);
    })
    .catch(err => {
      console.error('❌ MongoDB connection failed:', err.message);
      reject(err);
    });
  });
}

// Function to start the server
function startServer(networkIP) {
  console.log('\n🔧 Starting server on all interfaces (0.0.0.0:8080)...');
  console.log('📋 Server will be accessible at:');
  console.log('  - Local: http://localhost:8080');
  console.log('  - Network: http://' + networkIP + ':8080');
  console.log('  - All devices on same network: http://' + networkIP + ':8080');
  
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

// Main execution
async function main() {
  try {
    // Get network IPs
    const networkIPs = getNetworkIP();
    
    if (networkIPs.length === 0) {
      console.log('❌ No network interfaces found. Using localhost only.');
      console.log('💡 Make sure you are connected to a network.');
      process.exit(1);
    }
    
    const primaryIP = networkIPs[0].ip;
    
    console.log('📡 Available network interfaces:');
    networkIPs.forEach(({ interface, ip, netmask }) => {
      console.log(`  - ${interface}: ${ip} (${netmask})`);
    });
    
    console.log(`\n✅ Using primary IP: ${primaryIP}`);
    
    // Update frontend config
    const configUpdated = updateFrontendConfig(primaryIP);
    if (!configUpdated) {
      console.log('❌ Failed to update frontend config. Please check the error above.');
      process.exit(1);
    }
    
    // Check MongoDB
    try {
      await checkMongoDB();
    } catch (error) {
      console.log('\n💡 MongoDB is not running. Please start MongoDB first:');
      console.log('   - Windows: Start MongoDB service or run "mongod"');
      console.log('   - macOS: brew services start mongodb-community');
      console.log('   - Linux: sudo systemctl start mongod');
      console.log('\n🔄 Retrying in 5 seconds...');
      setTimeout(() => main(), 5000);
      return;
    }
    
    // Create network info file
    const info = {
      ip: primaryIP,
      port: 8080,
      url: `http://${primaryIP}:8080`,
      timestamp: new Date().toISOString(),
      instructions: [
        '1. Make sure your mobile device is on the same WiFi network',
        '2. The backend server is running on all interfaces (0.0.0.0:8080)',
        '3. The frontend has been configured to use this IP address',
        '4. If the IP changes, run this script again to update the frontend'
      ]
    };
    
    const infoPath = path.join(__dirname, 'network-info.json');
    fs.writeFileSync(infoPath, JSON.stringify(info, null, 2));
    console.log('📄 Network info saved to:', infoPath);
    
    console.log('\n🎉 Setup complete!');
    console.log('📋 Next steps:');
    console.log('  1. Start the frontend: npm start (in the root directory)');
    console.log('  2. Test on mobile device using the same WiFi network');
    console.log(`\n🌐 Backend URL: http://${primaryIP}:8080`);
    console.log('📱 Mobile devices can connect using this IP address');
    
    // Start the server
    startServer(primaryIP);
    
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

// Run the setup
main();

