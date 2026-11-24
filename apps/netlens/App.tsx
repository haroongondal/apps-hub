import React, { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { TabBar, ThemeProvider } from '@apps-hub/ui';

import { ScanProvider } from './src/scan/ScanProvider';
import DiagnosticsScreen from './src/screens/DiagnosticsScreen';
import HomeScreen from './src/screens/HomeScreen';
import RouterScreen from './src/screens/RouterScreen';
import ScannerScreen from './src/screens/ScannerScreen';

/**
 * Bottom navigation: Devices, Home, Router and Checks. Tabs unmount when hidden, but
 * the device scan lives in ScanProvider above them, so it survives tab changes. No external navigation dependency —
 * F-Droid footprint stays minimal with RN primitives only.
 */
type TabKey = 'scanner' | 'home' | 'router' | 'diagnostics';

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'scanner', label: 'Devices' },
  { key: 'home', label: 'Home' },
  { key: 'router', label: 'Router' },
  { key: 'diagnostics', label: 'Checks' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('scanner');

  // The new-device notification opens netlens://devices.
  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (url.startsWith('netlens://devices')) setActiveTab('scanner');
    });
    return () => sub.remove();
  }, []);

  return (
    <ThemeProvider brand="netlens">
      <ScanProvider>
        <View style={{ flex: 1 }}>
          {activeTab === 'scanner' ? (
            <ScannerScreen />
          ) : activeTab === 'home' ? (
            <HomeScreen />
          ) : activeTab === 'router' ? (
            <RouterScreen />
          ) : (
            <DiagnosticsScreen />
          )}
        </View>
        <TabBar tabs={TABS} value={activeTab} onChange={setActiveTab} />
      </ScanProvider>
    </ThemeProvider>
  );
}
