// Script to restart the Render server
// This will help wake up the sleeping server

const axios = require('axios');

async function restartRenderServer() {
  try {
    console.log('🔄 Attempting to restart Render server...');
    
    // Try to wake up the server with a simple request
    const response = await axios.get('https://backend-gr-x2ki.onrender.com', {
      timeout: 30000, // 30 second timeout
      headers: {
        'User-Agent': 'Server-Restart-Script'
      }
    });
    
    console.log('✅ Server responded:', response.status);
    console.log('✅ Server is now awake and running');
    
  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      console.log('⏰ Server is sleeping, trying to wake it up...');
      
      // Try multiple requests to wake up the server
      for (let i = 0; i < 3; i++) {
        try {
          console.log(`🔄 Wake-up attempt ${i + 1}/3...`);
          await axios.get('https://backend-gr-x2ki.onrender.com', {
            timeout: 15000,
            headers: {
              'User-Agent': 'Server-Wake-Up-Script'
            }
          });
          console.log('✅ Server woke up successfully!');
          return;
        } catch (wakeError) {
          console.log(`❌ Wake-up attempt ${i + 1} failed:`, wakeError.message);
          if (i < 2) {
            console.log('⏳ Waiting 5 seconds before next attempt...');
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
      }
      
      console.log('❌ Could not wake up server after 3 attempts');
      console.log('💡 The server might be completely down or there might be a network issue');
      
    } else {
      console.log('❌ Server error:', error.message);
    }
  }
}

restartRenderServer();
