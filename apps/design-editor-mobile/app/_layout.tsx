import { ThemeProvider } from '@apps-hub/ui';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { useShareIntake } from '../src/media/share';

export default function RootLayout() {
  useShareIntake();
  return (
    <ThemeProvider brand="design">
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
