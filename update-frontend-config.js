const os = require('os');
const fs = require('fs');
const path = require('path');

// Function to get network IP address
function getNetworkIP() {
  const interfaces = os.networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    for (const interface of interfaces[name]) {
      if (interface.family === 'IPv4' && !interface.internal) {
        return interface.address;
      }
    }
  }
  return 'localhost';
}

// Function to update frontend config
function updateFrontendConfig() {
  const networkIP = getNetworkIP();
  const frontendConfigPath = path.join(__dirname, '..', 'src', 'config', 'api.ts');
  
  try {
    // Read the current config
    let configContent = fs.readFileSync(frontendConfigPath, 'utf8');
    
    // Update the development baseURL (support both legacy and current comments)
    const updatedConfig = configContent
      .replace(
        /baseURL: 'http:\/\/[^']*', \/\/ Local backend - replace with your actual IP/,
        `baseURL: 'http://${networkIP}:8080', // Local backend - auto-updated`
      )
      .replace(
        /baseURL: 'http:\/\/[^']*', \/\/ Local backend - auto-updated/,
        `baseURL: 'http://${networkIP}:8080', // Local backend - auto-updated`
      );
    
    // Write the updated config
    fs.writeFileSync(frontendConfigPath, updatedConfig);
    
    console.log('✅ Frontend config updated successfully!');
    console.log(`📱 Frontend will now connect to: http://${networkIP}:8080`);
    console.log(`📁 Updated file: ${frontendConfigPath}`);
    
    return networkIP;
  } catch (error) {
    console.error('❌ Failed to update frontend config:', error.message);
    return null;
  }
}

// Function to create a network info file
function createNetworkInfo() {
  const networkIP = getNetworkIP();
  const info = {
    ip: networkIP,
    port: 8080,
    url: `http://${networkIP}:8080`,
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
  return info;
}

// Main execution
console.log('🔧 Updating frontend configuration for local development...\n');

const networkIP = updateFrontendConfig();
if (networkIP) {
  const info = createNetworkInfo();
  
  console.log('\n🎉 Setup complete!');
  console.log('📋 Next steps:');
  console.log('  1. Start the backend: node start-local.js');
  console.log('  2. Start the frontend: npm start (in the root directory)');
  console.log('  3. Test on mobile device using the same WiFi network');
  console.log(`\n🌐 Backend URL: http://${networkIP}:8080`);
  console.log('📱 Mobile devices can connect using this IP address');
} else {
  console.log('❌ Setup failed. Please check the error messages above.');
}

