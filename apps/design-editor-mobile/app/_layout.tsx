import { ThemeProvider } from '@apps-hub/ui';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { aiHubWarmUp } from '../src/editor/ai';
import { useShareIntake } from '../src/media/share';

export default function RootLayout() {
  useShareIntake();
  useEffect(aiHubWarmUp, []);
  return (
    <ThemeProvider brand="design">
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
