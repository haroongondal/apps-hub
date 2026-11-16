import React, { useCallback, useEffect, useState } from 'react';
import { AppState, BackHandler, View } from 'react-native';
import { Button, Header, Notice, Screen, TabBar, ThemeProvider } from '@apps-hub/ui';
import InflowCore, { type ItemFilter, type PartyTotal, type Status } from 'inflow-core';
import { AskScreen } from './src/AskScreen.tsx';
import { ContactsScreen } from './src/ContactsScreen.tsx';
import { HomeScreen } from './src/HomeScreen.tsx';
import { ListScreen } from './src/ListScreen.tsx';
import { LockScreen } from './src/LockScreen.tsx';
import { MoneyScreen } from './src/MoneyScreen.tsx';
import { partyTitle } from './src/money.ts';
import { PartyScreen } from './src/PartyScreen.tsx';
import { LOAD_ERROR } from './src/messages.ts';
import { SettingsScreen } from './src/SettingsScreen.tsx';
import { SetupScreen } from './src/SetupScreen.tsx';
import { setupComplete, setupRows } from './src/setup.ts';

type Tab = 'home' | 'money' | 'ask' | 'settings';
type Route =
  | { kind: 'items'; filter: ItemFilter; title: string }
  | { kind: 'contacts'; pkg: string; title: string }
  | { kind: 'party'; name: string | null; own: boolean; title: string };

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'home', label: 'Home' },
  { key: 'money', label: 'Money' },
  { key: 'ask', label: 'Ask AI' },
  { key: 'settings', label: 'Settings' },
];

function readStatus(): Status | null {
  try {
    return InflowCore.getStatus();
  } catch {
    return null;
  }
}

export default function App() {
  return (
    <ThemeProvider brand="inflow">
      <Root />
    </ThemeProvider>
  );
}

function Root() {
  const [locked, setLocked] = useState(true);
  const [status, setStatus] = useState(readStatus);
  const [inSetup, setInSetup] = useState(false);
  const [tab, setTab] = useState<Tab>('home');
  const [stack, setStack] = useState<Route[]>([]);

  const refresh = useCallback(() => setStatus(readStatus()), []);
  const complete = status !== null && setupComplete(setupRows(status));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') {
        setLocked(true);
        setStack([]);
        setTab('home');
      } else if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);
  useEffect(() => {
    if (status && !complete) setInSetup(true);
  }, [status, complete]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (locked || stack.length === 0) return false;
      setStack((s) => s.slice(0, -1));
      return true;
    });
    return () => sub.remove();
  }, [locked, stack.length]);

  const push = (r: Route) => setStack((s) => [...s, r]);
  const open = (filter: ItemFilter, title: string) => push({ kind: 'items', filter, title });
  const openContacts = (pkg: string, title: string) => push({ kind: 'contacts', pkg, title });
  const openParty = (p: PartyTotal) => push({ kind: 'party', name: p.name, own: p.own, title: partyTitle(p) });
  const back = () => setStack((s) => s.slice(0, -1));

  if (locked) {
    return (
      <LockScreen
        onUnlocked={() => {
          refresh();
          setLocked(false);
        }}
      />
    );
  }
  if (status === null) {
    return (
      <Screen scroll>
        <Header title="Inflow" />
        <Notice tone="danger">{LOAD_ERROR}</Notice>
        <Button label="Try again" onPress={refresh} />
      </Screen>
    );
  }
  if (inSetup || !complete) return <SetupScreen status={status} onAction={refresh} onFinished={() => setInSetup(false)} />;

  const top = stack.length > 0 ? stack[stack.length - 1] : null;
  if (top?.kind === 'items') return <ListScreen key={stack.length} title={top.title} filter={top.filter} onBack={back} onOpen={open} />;
  if (top?.kind === 'contacts') return <ContactsScreen key={stack.length} title={top.title} pkg={top.pkg} onBack={back} onOpen={open} />;
  if (top?.kind === 'party') return <PartyScreen key={stack.length} title={top.title} name={top.name} own={top.own} onBack={back} />;

  return (
    <>
      <View style={{ flex: 1 }}>
        {tab === 'home' ? (
          <HomeScreen status={status} refreshStatus={refresh} onOpen={open} onOpenContacts={openContacts} onOpenMoney={() => setTab('money')} />
        ) : tab === 'money' ? (
          <MoneyScreen status={status} onOpenParty={openParty} />
        ) : tab === 'ask' ? (
          <AskScreen />
        ) : (
          <SettingsScreen status={status} refreshStatus={refresh} />
        )}
      </View>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
    </>
  );
}
