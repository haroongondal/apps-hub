import React from 'react';
import { Header, Screen, Text, ThemeProvider } from '@apps-hub/ui';
import HaloEngine from 'halo-engine';

export default function App() {
  return (
    <ThemeProvider brand="halo">
      <Screen>
        <Header title="Halo" />
        <Text variant="data" tone="muted">{HaloEngine.ping()}</Text>
      </Screen>
    </ThemeProvider>
  );
}
