import React, { useState } from 'react';
import { View } from 'react-native';
import { TabBar, ThemeProvider } from '@apps-hub/ui';

import DiagnosticsScreen from './src/screens/DiagnosticsScreen';
import RouterScreen from './src/screens/RouterScreen';
import ScannerScreen from './src/screens/ScannerScreen';

/**
 * Bottom navigation: Devices, Router and Checks. Tabs unmount when hidden, so
 * a screen's work stops when you leave it. No external navigation dependency —
 * F-Droid footprint stays minimal with RN primitives only.
 */
type TabKey = 'scanner' | 'router' | 'diagnostics';

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'scanner', label: 'Devices' },
  { key: 'router', label: 'Router' },
  { key: 'diagnostics', label: 'Checks' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('scanner');

  return (
    <ThemeProvider brand="netlens">
      <View style={{ flex: 1 }}>
        {activeTab === 'scanner' ? <ScannerScreen /> : activeTab === 'router' ? <RouterScreen /> : <DiagnosticsScreen />}
      </View>
      <TabBar tabs={TABS} value={activeTab} onChange={setActiveTab} />
    </ThemeProvider>
  );
}
