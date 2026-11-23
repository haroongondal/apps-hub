import React, { useCallback, useEffect, useRef, useState } from 'react';
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

  // A new share replaces whatever sheet is open (the app that proposed a replaced task hears it was not kept); the key resets its typed instruction.
  const proposal = useRef<string | null>(null);
  const open = useCallback((input: SharedInput) => {
    if (proposal.current) DeputyAgent.settleProposal(proposal.current, false);
    proposal.current = input.proposalId;
    setTab('tasks');
    setShared({ key: Date.now(), input });
  }, []);
  const close = useCallback((kept: boolean) => {
    if (proposal.current) DeputyAgent.settleProposal(proposal.current, kept);
    proposal.current = null;
    setShared(null);
  }, []);
  const takeShare = useCallback(() => {
    const s = DeputyAgent.takeSharedText();
    if (s) open({ id: null, instruction: '', ...s, source: null, apps: [], proposalId: null });
  }, [open]);
  const takeProposal = useCallback(() => {
    const p = DeputyAgent.takeProposal();
    if (p) open({ id: null, instruction: p.instruction, text: p.text, subject: null, cut: false, source: p.source, apps: p.apps, proposalId: p.id });
  }, [open]);

  useEffect(() => {
    takeShare();
    takeProposal();
    const subs = [DeputyAgent.addListener('onShare', takeShare), DeputyAgent.addListener('onProposal', takeProposal)];
    return () => subs.forEach((s) => s.remove());
  }, [takeShare, takeProposal]);

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
              onOpen={(d) => open({ id: d.id, instruction: d.instruction, text: d.text, subject: d.subject, cut: false, source: d.source, apps: d.apps, proposalId: null })}
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
          onClose={close}
          onSaved={() => setDrafts(DeputyAgent.listDrafts())}
          refresh={refresh}
        />
      )}
    </>
  );
}
