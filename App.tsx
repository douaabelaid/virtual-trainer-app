import { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, SafeAreaView, Dimensions, Button, TouchableOpacity } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { CameraView, useCameraPermissions } from 'expo-camera';

const WS_URL = 'ws://10.114.161.12:8765'; // Your PC's Local IP address

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function App() {
  const [exerciseState, setExerciseState] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [useMock, setUseMock] = useState(false); // Changed to false to test real connection
  const ws = useRef<WebSocket | null>(null);
  const cameraRef = useRef<any>(null);
  
  const [permission, requestPermission] = useCameraPermissions();
  const frameInterval = useRef<any>(null);

  useEffect(() => {
    let reconnectTimeout: any;
    let isActive = true;

    if (useMock) {
      setIsConnected(true);
      const mockInterval = startMockDataStream();
      return () => clearInterval(mockInterval);
    } else {
      const connectWebSocket = () => {
        if (!isActive) return;
        
        ws.current = new WebSocket(WS_URL);

        ws.current.onopen = () => {
          if (!isActive) {
            ws.current?.close();
            return;
          }
          console.log('Connected to Edge Device');
          setIsConnected(true);
        };

        ws.current.onmessage = (e) => {
          if (!isActive) return;
          try {
            const data = JSON.parse(e.data);
            setExerciseState(data);
          } catch (err) {
            console.error('Failed to parse message', err);
          }
        };

        ws.current.onerror = (e: any) => {
          console.log('WebSocket error', e.message);
        };

        ws.current.onclose = (e) => {
          console.log('WebSocket closed. Reconnecting...', e.reason);
          setIsConnected(false);
          stopStreamingFrames();
          if (isActive) {
            reconnectTimeout = setTimeout(connectWebSocket, 3000);
          }
        };
      };

      connectWebSocket();

      return () => {
        isActive = false;
        clearTimeout(reconnectTimeout);
        if (ws.current) {
          ws.current.onclose = null; // Prevent the reconnect loop
          ws.current.close();
          ws.current = null;
        }
      };
    }
  }, [useMock]);

  const startMockDataStream = () => {
    let mockRepCount = 0;
    let isDown = false;

    return setInterval(() => {
      isDown = !isDown;
      if (!isDown) mockRepCount++;

      const mockData = {
        timestamp_ms: Date.now(),
        exercise: "squat",
        stage: isDown ? "down" : "standing",
        rep_count: mockRepCount,
        joint_angles: {
          left_knee: isDown ? 75.0 : 170.0,
          right_knee: isDown ? 76.5 : 165.0,
          left_hip: isDown ? 90.0 : 175.0,
          back: 15.0
        },
        feedback_flags: isDown ? [
          { code: "KNEE_CAVE", message: "Left knee caving inward", severity: "warning" },
          { code: "DEPTH_OK", message: "Good depth", severity: "info" }
        ] : [],
        landmarks_raw: {
          left_knee: [0.41, isDown ? 0.7 : 0.6],
          right_knee: [0.59, isDown ? 0.7 : 0.6],
          left_hip: [0.42, isDown ? 0.6 : 0.4],
          right_hip: [0.58, isDown ? 0.6 : 0.4],
          nose: [0.5, isDown ? 0.4 : 0.2]
        }
      };
      
      setExerciseState(mockData);
    }, 2000);
  };

  const startStreamingFrames = () => {
    if (frameInterval.current) return;
    
    // Simulate streaming frames every 150ms (~6.6 fps) to the backend
    // High FPS in pure RN JS can bridge-block, adjust as necessary
    frameInterval.current = setInterval(async () => {
      if (cameraRef.current && ws.current?.readyState === WebSocket.OPEN) {
        try {
          const photo = await cameraRef.current.takePictureAsync({
            base64: true,
            quality: 0.2, // Lower quality for faster transmission
            scale: 0.5,
          });
          
          if (photo?.base64) {
            ws.current.send(JSON.stringify({ 
              type: 'frame', 
              data: photo.base64 
            }));
          }
        } catch (error) {
          console.error("Frame capture error:", error);
        }
      }
    }, 150);
  };

  const stopStreamingFrames = () => {
    if (frameInterval.current) {
      clearInterval(frameInterval.current);
      frameInterval.current = null;
    }
  };

  useEffect(() => {
    if (isConnected && !useMock && permission?.granted) {
      // Stream real camera frames over WS strictly when Live
      startStreamingFrames(); 
    }
    return () => stopStreamingFrames();
  }, [isConnected, useMock, permission]);

  const renderFeedback = () => {
    if (!exerciseState?.feedback_flags) return null;
    return exerciseState.feedback_flags.map((flag: any, index: number) => (
      <View key={index} style={[styles.feedbackBadge, flag.severity === 'warning' ? styles.warning : styles.info]}>
        <Text style={styles.feedbackText}>{flag.message}</Text>
      </View>
    ));
  };

  const renderSkeleton = () => {
    if (!exerciseState?.landmarks_raw) return null;
    const { landmarks_raw } = exerciseState;
    
    // Convert normalized coordinates (0.0 - 1.0) to screen pixel coordinates safely
    const points = Object.entries(landmarks_raw).map(([key, value]: [string, any]) => {
      if (Array.isArray(value) && value.length >= 2) {
        return (
          <Circle 
            key={key} 
            cx={value[0] * SCREEN_WIDTH * 0.9} 
            cy={value[1] * SCREEN_HEIGHT * 0.5} 
            r="5" 
            fill="#00ff00" 
          />
        );
      }
      return null;
    });

    return <>{points}</>;
  };

  if (!permission) {
    // Media permissions are still loading.
    return <View />;
  }

  if (!permission.granted) {
    // Media permissions are not granted yet.
    return (
      <View style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={{ textAlign: 'center', color: '#fff', fontSize: 18, marginBottom: 20 }}>
            We need your permission to show the camera for tracking
          </Text>
          <Button onPress={requestPermission} title="Grant Camera Permission" color="#00e5ff" />
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Virtual Trainer</Text>
        <TouchableOpacity 
          style={styles.mockToggleBtn} 
          onPress={() => setUseMock(!useMock)}
        >
          <Text style={{color: '#fff', fontSize: 10}}>
            {useMock ? 'Mocking Data' : 'Live Data'}
          </Text>
        </TouchableOpacity>
        <View style={[styles.statusIndicator, { backgroundColor: isConnected ? '#4caf50' : '#f44336' }]} />
      </View>

      <View style={styles.dashboard}>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>EXERCISE</Text>
          <Text style={styles.statValue}>{exerciseState?.exercise?.toUpperCase() || '--'}</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>REPS</Text>
          <Text style={styles.statValue}>{exerciseState?.rep_count || 0}</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>PHASE</Text>
          <Text style={styles.statValue}>{exerciseState?.stage?.toUpperCase() || '--'}</Text>
        </View>
      </View>

      <View style={styles.feedbackContainer}>
        {renderFeedback()}
      </View>

      <View style={styles.cameraPlaceholder}>
        <CameraView 
          ref={cameraRef}
          style={StyleSheet.absoluteFill} 
          facing="front"
        />
        {/* Svg Layer floats over the camera feed, explicitly outside the CameraView */}
        {exerciseState?.landmarks_raw && (
          <Svg height="100%" width="100%" style={StyleSheet.absoluteFill}>
            {renderSkeleton()}
          </Svg>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 20
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    paddingTop: 40, // For notch area offset
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  mockToggleBtn: {
    padding: 5,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#444'
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  dashboard: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 20,
    backgroundColor: '#1e1e1e',
  },
  statBox: {
    alignItems: 'center',
  },
  statLabel: {
    color: '#aaa',
    fontSize: 12,
    marginBottom: 5,
    fontWeight: 'bold',
  },
  statValue: {
    color: '#00e5ff',
    fontSize: 28,
    fontWeight: '800',
  },
  feedbackContainer: {
    padding: 15,
    minHeight: 80,
  },
  feedbackBadge: {
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  warning: {
    backgroundColor: 'rgba(244, 67, 54, 0.2)',
    borderWidth: 1,
    borderColor: '#f44336',
  },
  info: {
    backgroundColor: 'rgba(0, 229, 255, 0.2)',
    borderWidth: 1,
    borderColor: '#00e5ff',
  },
  feedbackText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '600',
  },
  cameraPlaceholder: {
    flex: 1,
    backgroundColor: '#000',
    margin: 15,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative'
  },
});
