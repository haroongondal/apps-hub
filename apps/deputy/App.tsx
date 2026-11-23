import React, { useCallback, useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { Button, Header, Notice, Screen, TabBar, ThemeProvider, useTheme } from '@apps-hub/ui';
import DeputyAgent, { type Draft } from 'deputy-agent';
import { AppsScreen } from './src/AppsScreen';
import { Drafts } from './src/Drafts';
import { History } from './src/History';
import { Repeating } from './src/Repeating';
import { RunPanel } from './src/RunPanel';
import { SavedTasks } from './src/SavedTasks';
import { SettingsScreen } from './src/SettingsScreen';
import { SharedTextSheet, type SharedInput } from './src/SharedTextSheet';
import { setupComplete, setupRows } from './src/setup';

type Tab = 'tasks' | 'repeat' | 'apps' | 'settings';

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'tasks', label: 'Tasks' },
  { key: 'repeat', label: 'Repeating' },
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
  const [tab, setTab] = useState<Tab>('tasks');

  const [drafts, setDrafts] = useState<Draft[]>(() => DeputyAgent.listDrafts());
  const [shared, setShared] = useState<{ key: number; input: SharedInput } | null>(null);

  const refresh = useCallback(() => setState(DeputyAgent.getServiceState()), []);

  // A new share replaces whatever sheet is open; the key resets its typed instruction.
  const open = useCallback((input: SharedInput) => {
    setTab('tasks');
    setShared({ key: Date.now(), input });
  }, []);
  const takeShare = useCallback(() => {
    const s = DeputyAgent.takeSharedText();
    if (s) open({ id: null, instruction: '', ...s });
  }, [open]);

  useEffect(() => {
    takeShare();
    const sub = DeputyAgent.addListener('onShare', takeShare);
    return () => sub.remove();
  }, [takeShare]);

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
            <Drafts
              drafts={drafts}
              onOpen={(d) => open({ id: d.id, instruction: d.instruction, text: d.text, subject: d.subject, cut: false })}
              onDelete={(d) => {
                DeputyAgent.deleteDraft(d.id);
                setDrafts(DeputyAgent.listDrafts());
              }}
            />
            <SavedTasks state={state} refresh={refresh} />
            <History state={state} refresh={refresh} />
          </Screen>
        )}
        {tab === 'repeat' && <Repeating state={state} />}
        {tab === 'apps' && <AppsScreen />}
        {tab === 'settings' && <SettingsScreen state={state} refresh={refresh} />}
      </View>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
      {shared && (
        <SharedTextSheet
          key={shared.key}
          input={shared.input}
          state={state}
          onClose={() => setShared(null)}
          onSaved={() => setDrafts(DeputyAgent.listDrafts())}
          refresh={refresh}
        />
      )}
    </>
  );
}
