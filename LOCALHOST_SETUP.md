# 🚀 Localhost Backend Setup for All IPs

This guide will help you set up the backend to run on localhost and make it accessible from all devices on your network.

## 📋 Prerequisites

1. **MongoDB** - Make sure MongoDB is running on your system
2. **Node.js** - Version 14 or higher
3. **Network Access** - All devices should be on the same WiFi network

## 🔧 Quick Start

### Option 1: Automated Setup (Recommended)

```bash
cd backend
npm run local
```

This will:
- ✅ Detect your network IP address
- ✅ Update frontend configuration automatically
- ✅ Check MongoDB connection
- ✅ Start the server on all interfaces (0.0.0.0:8080)

### Option 2: Manual Setup

1. **Update frontend config:**
   ```bash
   cd backend
   npm run update-config
   ```

2. **Start the server:**
   ```bash
   cd backend
   npm start
   ```

## 📱 Mobile Device Setup

1. **Connect to same WiFi** - Make sure your mobile device is on the same WiFi network as your computer
2. **Note the IP address** - The setup script will show you the IP address to use
3. **Test the connection** - Open a browser on your mobile device and go to `http://[YOUR_IP]:8080/api/health`

## 🔍 Troubleshooting

### MongoDB Issues
```bash
# Windows
net start MongoDB

# macOS
brew services start mongodb-community

# Linux
sudo systemctl start mongod
```

### Network Issues
1. **Check firewall** - Make sure Windows Firewall allows Node.js
2. **Check IP address** - Run `ipconfig` (Windows) or `ifconfig` (Mac/Linux) to verify IP
3. **Test connectivity** - Use `ping [YOUR_IP]` from mobile device

### Port Issues
- The server runs on port 8080 by default
- If port 8080 is busy, change `PORT` in `server.js` or set `PORT` environment variable

## 📊 Server Information

The server will be accessible at:
- **Local:** http://localhost:8080
- **Network:** http://[YOUR_IP]:8080
- **All interfaces:** 0.0.0.0:8080

## 🔄 Updating IP Address

If your IP address changes, run:
```bash
cd backend
npm run update-config
```

## 📁 Files Created

- `network-info.json` - Contains current network configuration
- Updated `src/config/api.ts` - Frontend configuration with correct IP

## 🚨 Important Notes

1. **Security** - This setup is for development only. Don't use in production without proper security measures
2. **Network** - All devices must be on the same network
3. **MongoDB** - Must be running before starting the server
4. **Firewall** - May need to allow Node.js through Windows Firewall

## 🎯 Testing

1. **Backend Health Check:**
   ```bash
   curl http://localhost:8080/api/health
   ```

2. **Mobile Test:**
   - Open browser on mobile device
   - Go to `http://[YOUR_IP]:8080/api/health`
   - Should see: `{"status":"OK","message":"Server is running"}`

3. **Frontend Test:**
   - Start the React Native app
   - Check console logs for successful API connections

## 🆘 Support

If you encounter issues:
1. Check the console output for error messages
2. Verify MongoDB is running
3. Check network connectivity
4. Ensure firewall settings allow the connection

