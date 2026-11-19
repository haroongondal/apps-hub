import React from 'react';
import { Header, Notice, Screen, ThemeProvider } from '@apps-hub/ui';
import { BRAND } from './src/brand';

export default function App() {
  return (
    <ThemeProvider brand={BRAND}>
      <Screen scroll>
        <Header title="AI hub" />
        <Notice>Add your Gemini or Groq keys to start.</Notice>
      </Screen>
    </ThemeProvider>
  );
}
