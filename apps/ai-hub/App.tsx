import React from 'react';
import { Header, Screen, ThemeProvider } from '@apps-hub/ui';
import { BRAND } from './src/brand';
import { AppsGroup } from './src/AppsGroup';
import { KeysGroup } from './src/KeysGroup';
import { ModelsGroup } from './src/ModelsGroup';
import { RecentGroup } from './src/RecentGroup';

export default function App() {
  return (
    <ThemeProvider brand={BRAND}>
      <Screen scroll>
        <Header title="AI hub" />
        <KeysGroup />
        <ModelsGroup />
        <AppsGroup />
        <RecentGroup />
      </Screen>
    </ThemeProvider>
  );
}
