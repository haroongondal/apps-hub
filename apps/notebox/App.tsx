import React, { useCallback, useEffect, useState } from 'react';
import { AppState, BackHandler, View } from 'react-native';
import { Button, Header, Notice, Screen, TabBar, ThemeProvider } from '@apps-hub/ui';
import NoteboxCore, { type ItemFilter, type Status } from 'notebox-core';
import { HomeScreen } from './src/HomeScreen.tsx';
import { ListScreen } from './src/ListScreen.tsx';
import { LockScreen } from './src/LockScreen.tsx';
import { LOAD_ERROR } from './src/messages.ts';
import { SettingsScreen } from './src/SettingsScreen.tsx';
import { SetupScreen } from './src/SetupScreen.tsx';
import { setupComplete, setupRows } from './src/setup.ts';

type Tab = 'home' | 'settings';
interface Route {
  filter: ItemFilter;
  title: string;
}

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'home', label: 'Home' },
  { key: 'settings', label: 'Settings' },
];

function readStatus(): Status | null {
  try {
    return NoteboxCore.getStatus();
  } catch {
    return null;
  }
}

export default function App() {
  return (
    <ThemeProvider brand="notebox">
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

  const open = (filter: ItemFilter, title: string) => setStack((s) => [...s, { filter, title }]);

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
        <Header title="Notebox" />
        <Notice tone="danger">{LOAD_ERROR}</Notice>
        <Button label="Try again" onPress={refresh} />
      </Screen>
    );
  }
  if (inSetup || !complete) return <SetupScreen status={status} onAction={refresh} onFinished={() => setInSetup(false)} />;

  const top = stack.length > 0 ? stack[stack.length - 1] : null;
  if (top) return <ListScreen key={stack.length} title={top.title} filter={top.filter} onBack={() => setStack((s) => s.slice(0, -1))} onOpen={open} />;

  return (
    <>
      <View style={{ flex: 1 }}>
        {tab === 'home' ? <HomeScreen status={status} refreshStatus={refresh} onOpen={open} /> : <SettingsScreen status={status} refreshStatus={refresh} />}
      </View>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
    </>
  );
}
