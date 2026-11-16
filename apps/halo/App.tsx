import React from 'react';
import { ThemeProvider } from '@apps-hub/ui';
import DiagnosticsScreen from './src/DiagnosticsScreen.tsx';

export default function App() {
  return (
    <ThemeProvider brand="halo">
      <DiagnosticsScreen />
    </ThemeProvider>
  );
}
