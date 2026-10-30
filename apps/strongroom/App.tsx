import React from 'react';
import { Header, Screen, ThemeProvider } from '@apps-hub/ui';

export default function App() {
  return (
    <ThemeProvider brand="strongroom">
      <Screen>
        <Header title="Strongroom" />
      </Screen>
    </ThemeProvider>
  );
}
