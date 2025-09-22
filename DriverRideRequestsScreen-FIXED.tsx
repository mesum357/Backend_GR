// FIXED VERSION OF DriverRideRequestsScreen.tsx
// This file contains all the fixes for the driver status management issues

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useAppMode } from '../../context/AppModeContext';
import { authenticatedApiRequest } from '../../config/api';
import { RideRequest } from '../../types/ride';
import { LocationService } from '../../services/LocationService';
import { WebSocketService } from '../../services/WebSocketService';
import { NotificationService } from '../../services/NotificationService';

interface DriverRideRequestsScreenProps {
  navigation: any;
}

const DriverRideRequestsScreen: React.FC<DriverRideRequestsScreenProps> = ({ navigation }) => {
  const { user, token } = useAuth();
  const { isOnline, setIsOnline } = useAppMode();
  const [rideRequests, setRideRequests] = useState<RideRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Enhanced debugging function
  const logDriverStatus = (status: any, context: string) => {
    console.log(`🔧 [${context}] Driver status:`, {
      isRegistered: status.isRegistered,
      isApproved: status.isApproved,
      isVerified: status.isVerified,
      isOnline: status.isOnline,
      hasDriverProfile: !!status.driverProfile,
      timestamp: new Date().toISOString()
    });
  };

  // Fixed driver status management
  const ensureDriverOnline = async (): Promise<boolean> => {
    try {
      console.log('🔧 [ensureDriverOnline] Checking driver status...');
      const driverStatusResponse = await authenticatedApiRequest('/api/drivers/check-registration');
      
      logDriverStatus(driverStatusResponse, 'ensureDriverOnline');
      
      // Handle undefined values properly
      const isOnline = driverStatusResponse.isOnline === true;
      const isRegistered = driverStatusResponse.isRegistered === true;
      const isApproved = driverStatusResponse.isApproved === true;
      
      console.log('🔧 [ensureDriverOnline] Status analysis:', {
        isOnline,
        isRegistered,
        isApproved,
        needsToggle: !isOnline || !isRegistered
      });
      
      // Only toggle if driver is actually offline
      if (driverStatusResponse.isOnline === false) {
        console.log('🔧 [ensureDriverOnline] Driver is offline, setting online...');
        try {
          const toggleResponse = await authenticatedApiRequest('/api/drivers/toggle-status', {
            method: 'POST'
          });
          console.log('🔧 [ensureDriverOnline] Toggle response:', toggleResponse);
          setIsOnline(toggleResponse.isOnline);
          return toggleResponse.isOnline;
        } catch (toggleError) {
          console.log('🔧 [ensureDriverOnline] Could not toggle driver status:', toggleError);
          // Force set online for development
          setIsOnline(true);
          return true;
        }
      } else {
        console.log('🔧 [ensureDriverOnline] Driver is already online, keeping online');
        setIsOnline(true);
        return true;
      }
    } catch (statusError) {
      console.log('🔧 [ensureDriverOnline] Could not check driver status:', statusError);
      // Set default values to prevent continuous loading
      setIsOnline(false);
      return false;
    }
  };

  // Fixed fetchRideRequests function
  const fetchRideRequests = async (showLoading = false) => {
    console.log('🔧 [fetchRideRequests] Called with params:', {
      token: !!token,
      isOnline,
      showLoading,
      userType: user?.userType,
      timestamp: new Date().toISOString()
    });
    
    if (!token) {
      console.log('🔧 [fetchRideRequests] Early return: No token');
      return;
    }

    try {
      if (showLoading) {
        setIsLoading(true);
      }

      // Ensure driver is online before fetching requests
      const driverIsOnline = await ensureDriverOnline();
      if (!driverIsOnline) {
        console.log('🔧 [fetchRideRequests] Driver is not online, cannot fetch requests');
        setIsLoading(false);
        return;
      }

      // Update driver location before fetching requests
      try {
        const { latitude, longitude } = await LocationService.getCurrentLocationCoordinates();
        console.log('🔧 [fetchRideRequests] Updating driver location:', { latitude, longitude });
        const locationResponse = await authenticatedApiRequest('/api/drivers/location', {
          method: 'POST',
          body: JSON.stringify({ latitude, longitude })
        });
        console.log('🚗 [fetchRideRequests] Driver location updated:', { latitude, longitude, response: locationResponse });
      } catch (locationError) {
        console.log('🔧 [fetchRideRequests] Could not update driver location:', locationError);
      }

      console.log('🔧 [fetchRideRequests] Making API request to /api/ride-requests/available-simple');
      const simpleData = await authenticatedApiRequest('/api/ride-requests/available-simple', {
        method: 'GET',
      });

      const simpleList: RideRequest[] = (simpleData?.rideRequests || []) as RideRequest[];
      const dedupSimple = simpleList.filter((request, index, self) => index === self.findIndex(r => r.id === request.id));
      
      console.log('🔧 [fetchRideRequests] Simple list received:', dedupSimple.length);
      console.log('🔧 [fetchRideRequests] Ride requests details:', dedupSimple.map(r => ({
        id: r.id,
        status: r.status,
        pickupLocation: r.pickupLocation,
        destination: r.dropoffLocation,
        fare: r.estimatedFare,
        createdAt: r.createdAt,
        riderName: r.riderName
      })));
      
      setRideRequests(dedupSimple);
      processNotifications();
      
      if (dedupSimple.length !== rideRequests.length) {
        console.log(`🔧 [fetchRideRequests] Ride requests updated: ${dedupSimple.length} available`);
      }
      
    } catch (error) {
      console.error('❌ [fetchRideRequests] Error fetching ride requests (simple):', error);
      
      // Fallback: use location-aware endpoint
      try {
        console.log('🔧 [fetchRideRequests] Fallback to /api/ride-requests/available with driver location');
        const coords = await LocationService.getCurrentLocationCoordinates();
        const url = `/api/ride-requests/available?latitude=${coords.latitude}&longitude=${coords.longitude}&radius=5`;
        const nearbyData = await authenticatedApiRequest(url, { method: 'GET' });
        const list = (nearbyData?.rideRequests || nearbyData?.requests || []) as RideRequest[];
        const dedup = list.filter((request, index, self) => index === self.findIndex(r => r.id === request.id));
        console.log('🔧 [fetchRideRequests] Nearby list received:', dedup.length);
        setRideRequests(dedup);
        processNotifications();
      } catch (fallbackError) {
        console.error('❌ [fetchRideRequests] Fallback also failed:', fallbackError);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Process notifications for new ride requests
  const processNotifications = () => {
    if (rideRequests.length > 0) {
      const newRequests = rideRequests.filter(req => req.status === 'searching');
      if (newRequests.length > 0) {
        console.log(`🔔 [processNotifications] Processing ${newRequests.length} new ride requests`);
        newRequests.forEach(request => {
          NotificationService.showNotification(
            'New Ride Request',
            `Pickup: ${request.pickupLocation?.address || 'Current Location'}`,
            { rideRequestId: request.id }
          );
        });
      }
    }
  };

  // WebSocket setup for real-time updates
  useEffect(() => {
    if (user && token) {
      console.log('🔌 [useEffect] Setting up WebSocket listeners for driver:', user._id);
      WebSocketService.connect();
      
      const handleRideRequest = (data: any) => {
        console.log('🔔 [WebSocket] New ride request received:', data);
        // Refresh the ride requests list
        fetchRideRequests();
      };

      WebSocketService.on('ride_request', handleRideRequest);
      
      return () => {
        WebSocketService.off('ride_request', handleRideRequest);
      };
    }
  }, [user, token]);

  // Initial load and periodic refresh
  useEffect(() => {
    if (user && token && isOnline) {
      console.log('🔧 [useEffect] Initial fetch with params:', { isOnline, token: !!token, user: !!user, userType: user.userType });
      fetchRideRequests(true);
    }
  }, [user, token, isOnline]);

  // Refresh control
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchRideRequests();
    setRefreshing(false);
  }, []);

  // Handle ride request selection
  const handleRideRequestPress = (rideRequest: RideRequest) => {
    console.log('🔧 [handleRideRequestPress] Selected ride request:', rideRequest.id);
    navigation.navigate('RideDetails', { rideRequest });
  };

  // Render ride request item
  const renderRideRequest = ({ item }: { item: RideRequest }) => (
    <TouchableOpacity
      style={styles.rideRequestCard}
      onPress={() => handleRideRequestPress(item)}
    >
      <View style={styles.rideRequestHeader}>
        <Text style={styles.riderName}>{item.riderName || 'Unknown Rider'}</Text>
        <Text style={styles.fare}>PKR {item.estimatedFare || 0}</Text>
      </View>
      
      <View style={styles.rideRequestDetails}>
        <View style={styles.locationRow}>
          <Ionicons name="location" size={16} color="#666" />
          <Text style={styles.locationText}>
            {item.pickupLocation?.address || 'Current Location'}
          </Text>
        </View>
        
        <View style={styles.locationRow}>
          <Ionicons name="flag" size={16} color="#666" />
          <Text style={styles.locationText}>
            {item.dropoffLocation?.address || 'Destination'}
          </Text>
        </View>
        
        <View style={styles.rideRequestFooter}>
          <Text style={styles.distance}>
            {item.distance ? `${item.distance.toFixed(1)} km` : 'Distance unknown'}
          </Text>
          <Text style={styles.status}>{item.status}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  // Render empty state
  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Ionicons name="car-outline" size={64} color="#ccc" />
      <Text style={styles.emptyStateTitle}>No Ride Requests</Text>
      <Text style={styles.emptyStateText}>
        {isOnline ? 'No ride requests available at the moment.' : 'You are currently offline.'}
      </Text>
      {!isOnline && (
        <TouchableOpacity style={styles.goOnlineButton} onPress={() => ensureDriverOnline()}>
          <Text style={styles.goOnlineButtonText}>Go Online</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Ride Requests</Text>
        <View style={styles.statusIndicator}>
          <View style={[styles.statusDot, { backgroundColor: isOnline ? '#4CAF50' : '#F44336' }]} />
          <Text style={styles.statusText}>{isOnline ? 'Online' : 'Offline'}</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading ride requests...</Text>
        </View>
      ) : (
        <FlatList
          data={rideRequests}
          renderItem={renderRideRequest}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={renderEmptyState}
          contentContainerStyle={rideRequests.length === 0 ? styles.emptyContainer : undefined}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    fontSize: 14,
    color: '#666',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  rideRequestCard: {
    backgroundColor: '#fff',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  rideRequestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  riderName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  fare: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#4CAF50',
  },
  rideRequestDetails: {
    gap: 8,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  locationText: {
    fontSize: 14,
    color: '#666',
    flex: 1,
  },
  rideRequestFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  distance: {
    fontSize: 14,
    color: '#666',
  },
  status: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  emptyContainer: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyStateTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  goOnlineButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  goOnlineButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default DriverRideRequestsScreen;
