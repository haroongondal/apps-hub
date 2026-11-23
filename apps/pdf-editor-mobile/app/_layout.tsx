import { ThemeProvider } from '@apps-hub/ui';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { startWorker } from '../src/nexus/worker';
import { syncPlaceReminders } from '../src/places/sync';

export default function RootLayout() {
  useEffect(() => startWorker(), []);
  useEffect(() => {
    syncPlaceReminders().catch((err) => console.warn('Could not sync place reminders', err));
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider brand="pdf">
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="folder" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="item" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="settings" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="meeting" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="cv/new" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="cv/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="editor" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="scan/capture" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="scan/review" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="scan/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="scan/page" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="scan-text" options={{ animation: 'slide_from_right' }} />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
