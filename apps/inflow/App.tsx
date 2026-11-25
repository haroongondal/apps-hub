import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, View } from 'react-native';
import { Button, Header, Notice, Screen, TabBar, ThemeProvider } from '@apps-hub/ui';
import InflowCore, { type ItemFilter, type PartyTotal, type ReportRow, type Status } from 'inflow-core';
import { AppsScreen } from './src/AppsScreen.tsx';
import { AskScreen } from './src/AskScreen.tsx';
import { ContactsScreen } from './src/ContactsScreen.tsx';
import { DoctorScreen } from './src/DoctorScreen.tsx';
import { HealthScreen } from './src/HealthScreen.tsx';
import { HomeScreen } from './src/HomeScreen.tsx';
import { JournalScreen } from './src/JournalScreen.tsx';
import { ListScreen } from './src/ListScreen.tsx';
import { LockScreen } from './src/LockScreen.tsx';
import { appStateDecision } from './src/lockGrace.ts';
import { MedicinesScreen } from './src/MedicinesScreen.tsx';
import { MoneyScreen } from './src/MoneyScreen.tsx';
import { partyTitle } from './src/money.ts';
import { PartyScreen } from './src/PartyScreen.tsx';
import { reportTitle } from './src/report.ts';
import { ReportScreen } from './src/ReportScreen.tsx';
import { LOAD_ERROR } from './src/messages.ts';
import { SettingsScreen } from './src/SettingsScreen.tsx';
import { SetupScreen } from './src/SetupScreen.tsx';
import { TodosScreen } from './src/TodosScreen.tsx';
import { VitalsScreen } from './src/VitalsScreen.tsx';
import { setupComplete, setupRows } from './src/setup.ts';
import { useAutoReceipts } from './src/useAutoReceipts.ts';

type Tab = 'home' | 'money' | 'ask' | 'settings';
type Route =
  | { kind: 'items'; filter: ItemFilter; title: string }
  | { kind: 'contacts'; pkg: string; title: string; promo: boolean }
  | { kind: 'apps' }
  | { kind: 'health' }
  | { kind: 'vitals' }
  | { kind: 'medicines' }
  | { kind: 'journal' }
  | { kind: 'doctor' }
  | { kind: 'party'; name: string | null; own: boolean; title: string }
  | { kind: 'report'; id: number; title: string };

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
  const [todosOpen, setTodosOpen] = useState(false);

  const lockedRef = useRef(true);
  lockedRef.current = locked;

  const refresh = useCallback(() => setStatus(readStatus()), []);
  // A tapped report notification waits in the native module; it is read only while unlocked, so a locked phone keeps it until the fingerprint.
  const openTappedReport = useCallback(() => {
    try {
      const id = InflowCore.takeOpenReport();
      const r = id === null ? null : InflowCore.getReport(id);
      if (r) setStack((s) => [...s, { kind: 'report', id: r.row.id, title: reportTitle(r.row) }]);
    } catch {
      // No report to open: stay where we are.
    }
  }, []);
  const complete = status !== null && setupComplete(setupRows(status));
  useAutoReceipts(!locked && complete);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      const decision = appStateDecision(s, Date.now());
      if (s === 'background') {
        if (decision !== 'lock') return;
        setLocked(true);
        setStack([]);
        setTodosOpen(false);
        setTab('home');
      } else if (s === 'active') {
        if (decision === 'lock') setLocked(true);
        refresh();
        if (decision !== 'lock' && !lockedRef.current) openTappedReport();
      }
    });
    return () => sub.remove();
  }, [refresh, openTappedReport]);
  useEffect(() => {
    if (status && !complete) setInSetup(true);
  }, [status, complete]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (locked) return false;
      if (stack.length > 0) {
        setStack((s) => s.slice(0, -1));
        return true;
      }
      if (todosOpen) {
        setTodosOpen(false);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [locked, stack.length, todosOpen]);

  const push = (r: Route) => setStack((s) => [...s, r]);
  const open = (filter: ItemFilter, title: string) => push({ kind: 'items', filter, title });
  const openContacts = (pkg: string, title: string, promo = false) => push({ kind: 'contacts', pkg, title, promo });
  const openParty = (p: PartyTotal) => push({ kind: 'party', name: p.name, own: p.own, title: partyTitle(p) });
  const openReport = (r: Pick<ReportRow, 'id' | 'kind' | 'periodStart' | 'partial'>) => push({ kind: 'report', id: r.id, title: reportTitle(r) });
  const back = () => setStack((s) => s.slice(0, -1));

  if (locked) {
    return (
      <LockScreen
        onUnlocked={() => {
          refresh();
          setLocked(false);
          openTappedReport();
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
  if (top?.kind === 'contacts') {
    const { pkg } = top;
    return <ContactsScreen key={stack.length} title={top.title} pkg={pkg} promo={top.promo} onBack={back} onOpen={open} onOpenPromotions={() => openContacts(pkg, 'Promotions', true)} />;
  }
  if (top?.kind === 'apps') return <AppsScreen key={stack.length} onBack={back} onOpen={open} onOpenContacts={openContacts} />;
  if (top?.kind === 'health') return <HealthScreen key={stack.length} onBack={back} onOpenVitals={() => push({ kind: 'vitals' })} onOpenMedicines={() => push({ kind: 'medicines' })} onOpenJournal={() => push({ kind: 'journal' })} onOpenDoctor={() => push({ kind: 'doctor' })} />;
  if (top?.kind === 'vitals') return <VitalsScreen key={stack.length} onBack={back} />;
  if (top?.kind === 'medicines') return <MedicinesScreen key={stack.length} onBack={back} />;
  if (top?.kind === 'journal') return <JournalScreen key={stack.length} onBack={back} />;
  if (top?.kind === 'doctor') return <DoctorScreen key={stack.length} onBack={back} />;
  if (top?.kind === 'report') return <ReportScreen key={stack.length} id={top.id} title={top.title} onBack={back} />;
  if (top?.kind === 'party') return <PartyScreen key={stack.length} title={top.title} name={top.name} own={top.own} onBack={back} />;

  if (todosOpen) return <TodosScreen onBack={() => setTodosOpen(false)} onOpen={open} />;

  return (
    <>
      <View style={{ flex: 1 }}>
        {tab === 'home' ? (
          <HomeScreen status={status} refreshStatus={refresh} onOpen={open} onOpenContacts={openContacts} onOpenMoney={() => setTab('money')} onOpenApps={() => push({ kind: 'apps' })} onOpenTodos={() => setTodosOpen(true)} onOpenHealth={() => push({ kind: 'health' })} />
        ) : tab === 'money' ? (
          <MoneyScreen status={status} onOpenParty={openParty} onOpenReport={openReport} />
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
