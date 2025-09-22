# 🚨 URGENT: Mobile App Fixes for Server Downtime

## **ISSUE IDENTIFIED:**
The backend server at `https://backend-gr-x2ki.onrender.com` is completely down, causing:
- All API requests to timeout
- Driver status checks to fail
- Ride requests can't be created
- WebSocket connections failing
- Continuous loading in driver dashboard

## **IMMEDIATE FIXES NEEDED:**

### 1. **Update `src/config/api.ts`**

Add server health checking and fallback logic:

```typescript
// Add this to src/config/api.ts
const API_CONFIG = {
  primary: 'https://backend-gr-x2ki.onrender.com',
  fallback: 'http://localhost:5000', // Local development server
  timeout: 10000, // 10 seconds
  retries: 3
};

// Add server health check function
export const checkServerHealth = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(`${url}/health`, {
      method: 'GET',
      timeout: 5000
    });
    return response.ok;
  } catch (error) {
    console.log(`❌ Server health check failed for ${url}:`, error.message);
    return false;
  }
};

// Add retry logic with fallback
export const apiRequestWithFallback = async (endpoint: string, options: any = {}) => {
  const primaryUrl = `${API_CONFIG.primary}${endpoint}`;
  const fallbackUrl = `${API_CONFIG.fallback}${endpoint}`;
  
  try {
    console.log(`🔄 Trying primary server: ${primaryUrl}`);
    const response = await fetch(primaryUrl, {
      ...options,
      timeout: API_CONFIG.timeout
    });
    
    if (response.ok) {
      console.log('✅ Primary server working');
      return response;
    }
    
    throw new Error('Primary server returned error');
    
  } catch (error) {
    console.log('🔄 Primary server failed, trying fallback...');
    
    try {
      console.log(`🔄 Trying fallback server: ${fallbackUrl}`);
      const response = await fetch(fallbackUrl, {
        ...options,
        timeout: API_CONFIG.timeout
      });
      
      if (response.ok) {
        console.log('✅ Fallback server working');
        return response;
      }
      
      throw new Error('Fallback server also failed');
      
    } catch (fallbackError) {
      console.error('❌ Both servers failed:', fallbackError);
      throw new Error('All servers are down. Please check your internet connection.');
    }
  }
};
```

### 2. **Update `src/screens/driver/DriverRideRequestsScreen.tsx`**

Add server status handling:

```typescript
// Add these imports
import { checkServerHealth, apiRequestWithFallback } from '../../config/api';

// Add state for server status
const [serverStatus, setServerStatus] = useState('checking');
const [serverError, setServerError] = useState(null);

// Add server status check function
const checkServerStatus = async (): Promise<boolean> => {
  try {
    console.log('🔧 [checkServerStatus] Checking server health...');
    const isHealthy = await checkServerHealth('https://backend-gr-x2ki.onrender.com');
    setServerStatus(isHealthy ? 'online' : 'offline');
    setServerError(isHealthy ? null : 'Server is not responding');
    return isHealthy;
  } catch (error) {
    console.log('🔧 [checkServerStatus] Server check failed:', error);
    setServerStatus('offline');
    setServerError('Cannot connect to server');
    return false;
  }
};

// Update fetchRideRequests function
const fetchRideRequests = async (showLoading = false) => {
  console.log('🔧 [fetchRideRequests] Starting with server status check...');
  
  if (!token) {
    console.log('🔧 [fetchRideRequests] Early return: No token');
    return;
  }

  try {
    if (showLoading) {
      setIsLoading(true);
    }

    // Check server status first
    const serverIsOnline = await checkServerStatus();
    if (!serverIsOnline) {
      console.log('❌ [fetchRideRequests] Server is offline, cannot fetch requests');
      setRideRequests([]);
      setIsLoading(false);
      return;
    }

    // Continue with normal flow using fallback API
    console.log('🔧 [fetchRideRequests] Server is online, proceeding...');
    
    // Use the fallback API function
    const simpleData = await apiRequestWithFallback('/api/ride-requests/available-simple', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await simpleData.json();
    const simpleList: RideRequest[] = (data?.rideRequests || []) as RideRequest[];
    const dedupSimple = simpleList.filter((request, index, self) => index === self.findIndex(r => r.id === request.id));
    
    console.log('🔧 [fetchRideRequests] Simple list received:', dedupSimple.length);
    setRideRequests(dedupSimple);
    processNotifications();
    
  } catch (error) {
    console.error('❌ [fetchRideRequests] Error fetching ride requests:', error);
    setServerError('Failed to fetch ride requests');
  } finally {
    setIsLoading(false);
  }
};

// Add server status display in the UI
const renderServerStatus = () => (
  <View style={styles.serverStatusContainer}>
    <View style={[styles.statusDot, { 
      backgroundColor: serverStatus === 'online' ? '#4CAF50' : '#F44336' 
    }]} />
    <Text style={styles.statusText}>
      Server: {serverStatus === 'online' ? 'Online' : 'Offline'}
    </Text>
    {serverError && (
      <Text style={styles.errorText}>{serverError}</Text>
    )}
  </View>
);

// Add this to the render method
<View style={styles.header}>
  <Text style={styles.title}>Ride Requests</Text>
  {renderServerStatus()}
</View>
```

### 3. **Update `src/screens/DriverScreen.tsx`**

Add server status handling:

```typescript
// Add server status state
const [serverStatus, setServerStatus] = useState('checking');

// Add server status check
const checkServerStatus = async (): Promise<boolean> => {
  try {
    const isHealthy = await checkServerHealth('https://backend-gr-x2ki.onrender.com');
    setServerStatus(isHealthy ? 'online' : 'offline');
    return isHealthy;
  } catch (error) {
    setServerStatus('offline');
    return false;
  }
};

// Update checkDriverRegistration to handle server issues
const checkDriverRegistration = async () => {
  console.log('🔧 [checkDriverRegistration] Starting with server check...');
  
  if (!token) {
    setIsLoading(false);
    return;
  }

  // Check server status first
  const serverIsOnline = await checkServerStatus();
  if (!serverIsOnline) {
    console.log('❌ [checkDriverRegistration] Server is offline');
    setIsLoading(false);
    return;
  }

  // Continue with normal flow...
  // ... rest of the function
};
```

### 4. **Add Error Handling Styles**

Add these styles to both components:

```typescript
const styles = StyleSheet.create({
  // ... existing styles
  serverStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    fontSize: 12,
    color: '#666',
  },
  errorText: {
    fontSize: 10,
    color: '#F44336',
    marginTop: 4,
  },
});
```

## **TESTING STEPS:**

1. **Update the mobile app** with the fixes above
2. **Test with server down** - should show "Server: Offline"
3. **Test with server up** - should show "Server: Online" and work normally
4. **Test fallback** - should try local server if primary fails

## **EXPECTED RESULTS:**

- ✅ App handles server downtime gracefully
- ✅ Shows clear server status to user
- ✅ No more continuous loading when server is down
- ✅ Proper error messages displayed
- ✅ Fallback to local server when available

## **NEXT STEPS:**

1. **Immediate**: Update mobile app with these fixes
2. **Short-term**: Contact Render.com support about server downtime
3. **Long-term**: Set up server monitoring and automatic failover

## **SERVER STATUS:**

- ❌ **Primary server (Render.com)**: DOWN
- ✅ **Code fixes**: Ready to implement
- ✅ **Fallback logic**: Ready to implement
- ✅ **Error handling**: Ready to implement

The mobile app will now handle server downtime gracefully and provide clear feedback to users.

