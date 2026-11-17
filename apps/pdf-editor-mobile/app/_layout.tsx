import { ThemeProvider } from '@apps-hub/ui';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider brand="pdf">
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="editor" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="scan/capture" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="scan/review" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="scan/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="scan/page" options={{ animation: 'slide_from_right' }} />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
