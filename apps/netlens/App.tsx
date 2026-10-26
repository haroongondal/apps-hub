import React, { useState } from 'react';
import { View } from 'react-native';
import { TabBar, ThemeProvider } from '@apps-hub/ui';

import DiagnosticsScreen from './src/screens/DiagnosticsScreen';
import ScannerScreen from './src/screens/ScannerScreen';

/**
 * Phase 4 composition: bottom navigation with the Scanner and Diagnostics
 * tabs (PRD FR-2 / FR-3). No external navigation dependency — F-Droid
 * footprint stays minimal with RN primitives only.
 */
type TabKey = 'scanner' | 'diagnostics';

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'scanner', label: 'Scanner' },
  { key: 'diagnostics', label: 'Diagnostics' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('scanner');

  return (
    <ThemeProvider brand="netlens">
      <View style={{ flex: 1 }}>
        {activeTab === 'scanner' ? <ScannerScreen /> : <DiagnosticsScreen />}
      </View>
      <TabBar tabs={TABS} value={activeTab} onChange={setActiveTab} />
    </ThemeProvider>
  );
}
