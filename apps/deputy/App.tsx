import React, { useCallback, useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { Button, Header, Notice, Screen, TabBar, ThemeProvider, useTheme } from '@apps-hub/ui';
import DeputyAgent from 'deputy-agent';
import { AppsScreen } from './src/AppsScreen';
import { History } from './src/History';
import { RunPanel } from './src/RunPanel';
import { SavedTasks } from './src/SavedTasks';
import { SettingsScreen } from './src/SettingsScreen';
import { setupComplete, setupRows } from './src/setup';

type Tab = 'tasks' | 'apps' | 'settings';

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'tasks', label: 'Tasks' },
  { key: 'apps', label: 'Apps' },
  { key: 'settings', label: 'Settings' },
];

export default function App() {
  return (
    <ThemeProvider brand="deputy">
      <Home />
    </ThemeProvider>
  );
}

function Home() {
  const { c } = useTheme();
  const [state, setState] = useState(() => DeputyAgent.getServiceState());
  const [tab, setTab] = useState<Tab>(() => (setupComplete(setupRows(state)) ? 'tasks' : 'settings'));

  const refresh = useCallback(() => setState(DeputyAgent.getServiceState()), []);

  useEffect(() => DeputyAgent.setPalette(JSON.stringify(c)), [c]);
  // Here, not in RunPanel: a run can end while another tab is open.
  useEffect(() => {
    const sub = DeputyAgent.addListener('onRunEvent', (e) => e.type === 'finished' && refresh());
    return () => sub.remove();
  }, [refresh]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  const openSetup = <Button label="Open setup" variant="secondary" size="sm" onPress={() => setTab('settings')} />;

  return (
    <>
      <View style={{ flex: 1 }}>
        {tab === 'tasks' && (
          <Screen scroll>
            <Header title="Deputy" subtitle="Tell Deputy a task, and it works your phone's apps to do it." />
            {!state.accessibilityEnabled ? (
              <Notice tone="danger" title="Deputy is off" action={openSetup}>
                Turn on the Deputy accessibility service. Without it Deputy cannot read or tap other apps.
              </Notice>
            ) : (
              !setupComplete(setupRows(state)) && (
                <Notice tone="warn" title="Setup isn't finished" action={openSetup}>
                  Finish the rows marked To do in Settings.
                </Notice>
              )
            )}
            <RunPanel state={state} refresh={refresh} />
            <SavedTasks state={state} refresh={refresh} />
            <History state={state} refresh={refresh} />
          </Screen>
        )}
        {tab === 'apps' && <AppsScreen />}
        {tab === 'settings' && <SettingsScreen state={state} refresh={refresh} />}
      </View>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
    </>
  );
}
