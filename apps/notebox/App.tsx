import React from 'react';
import { Header, Screen, ThemeProvider } from '@apps-hub/ui';

export default function App() {
  return (
    <ThemeProvider brand="notebox">
      <Screen>
        <Header title="Notebox" />
      </Screen>
    </ThemeProvider>
  );
}
