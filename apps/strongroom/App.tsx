import React, { useCallback, useEffect, useState } from 'react';
import { AppState, BackHandler, View } from 'react-native';
import { Button, Header, Notice, Screen, TabBar, ThemeProvider, palette } from '@apps-hub/ui';
import Vault, { addLockListener, type Status } from 'strongroom-vault';
import { deriving, messageOf } from './src/call.ts';
import { EditScreen } from './src/EditScreen.tsx';
import { EntryScreen } from './src/EntryScreen.tsx';
import { ImportScreen } from './src/ImportScreen.tsx';
import { SettingsScreen, type SettingsFlow } from './src/SettingsScreen.tsx';
import { ChangePasswordScreen, FingerprintScreen, NewRecoveryKeyScreen } from './src/SettingsFlows.tsx';
import { SetupScreen } from './src/SetupScreen.tsx';
import { UnlockScreen } from './src/UnlockScreen.tsx';
import { VaultScreen, type VaultView } from './src/VaultScreen.tsx';

type Tab = 'vault' | 'settings';
type Route =
  | { name: 'tabs' }
  | { name: 'entry'; id: string }
  | { name: 'edit'; id: string | null }
  | { name: 'import' }
  | { name: 'password' }
  | { name: 'fingerprint' }
  | { name: 'newKey'; key: string | null };

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'vault', label: 'Vault' },
  { key: 'settings', label: 'Settings' },
];

const TABS_ROUTE: Route = { name: 'tabs' };
const FLOW_ROUTES: Record<SettingsFlow, Route> = {
  password: { name: 'password' },
  fingerprint: { name: 'fingerprint' },
  newKey: { name: 'newKey', key: null },
  import: { name: 'import' },
};
const NO_VIEW: VaultView = { kind: 'login', query: '' };
const DISCARDED = 'Strongroom locked, so your unsaved changes were discarded.';

function readStatus(): Status | null {
  try {
    return Vault.getStatus();
  } catch {
    return null;
  }
}

export default function App() {
  return (
    <ThemeProvider brand="strongroom">
      <Home />
    </ThemeProvider>
  );
}

function Home() {
  const [status, setStatus] = useState(readStatus);
  const [fault, setFault] = useState<string | null>(null);
  const [inSetup, setInSetup] = useState(false);
  const [tab, setTab] = useState<Tab>('vault');
  const [route, setRoute] = useState<Route>(TABS_ROUTE);
  const [view, setView] = useState<VaultView>(NO_VIEW);
  const [notice, setNotice] = useState<string | null>(null);
  const [discarded, setDiscarded] = useState(false);

  const unlocked = status?.unlocked ?? false;
  const settingUp = inSetup || (status !== null && !status.setUp);

  // Never while a key derivation is pending: the bridge's sync calls would wait on it.
  const refresh = useCallback(() => {
    if (deriving()) return;
    try {
      setStatus(Vault.getStatus());
      setFault(null);
    } catch (e) {
      setFault(messageOf(e));
    }
  }, []);

  useEffect(() => {
    Vault.setPalette(JSON.stringify({ light: palette('strongroom', 'light'), dark: palette('strongroom', 'dark') }));
    if (status === null) refresh();
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);
  useEffect(() => {
    const sub = addLockListener(refresh);
    return () => sub.remove();
  }, [refresh]);
  useEffect(() => {
    if (status && !status.setUp) setInSetup(true);
  }, [status]);
  // A lock unmounts Entry and Edit (their revealed values and draft go with them); the next unlock starts from the vault list.
  useEffect(() => {
    if (unlocked) {
      setDiscarded(false);
      return;
    }
    setDiscarded(route.name === 'edit');
    setRoute(TABS_ROUTE);
    setTab('vault');
    setView(NO_VIEW);
    setNotice(null);
  }, [unlocked]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (deriving() || settingUp) return true;
      if (!unlocked || route.name === 'tabs') return false;
      if (route.name === 'newKey' && route.key !== null) return true;
      setRoute(route.name === 'edit' && route.id !== null ? { name: 'entry', id: route.id } : TABS_ROUTE);
      return true;
    });
    return () => sub.remove();
  }, [route, settingUp, unlocked]);

  const home = () => {
    if (!deriving()) setRoute(TABS_ROUTE);
  };
  const finishFlow = (done: string) => {
    setNotice(done);
    setTab('settings');
    setRoute(TABS_ROUTE);
    refresh();
  };
  const openFlow = (flow: SettingsFlow) => {
    setNotice(null);
    setRoute(FLOW_ROUTES[flow]);
  };

  if (fault) {
    return (
      <Screen scroll>
        <Header title="Strongroom hit a problem" />
        <Notice tone="danger">{fault}</Notice>
        <Button label="Try again" onPress={refresh} />
      </Screen>
    );
  }
  if (status === null) return null;
  if (settingUp) {
    return (
      <SetupScreen
        status={status}
        onFinished={() => {
          setInSetup(false);
          refresh();
        }}
      />
    );
  }
  if (!status.unlocked) return <UnlockScreen status={status} notice={discarded ? DISCARDED : null} onUnlocked={refresh} />;

  if (route.name === 'entry') {
    return <EntryScreen id={route.id} onBack={home} onEdit={() => setRoute({ name: 'edit', id: route.id })} onLocked={refresh} />;
  }
  if (route.name === 'edit') {
    const { id } = route;
    return <EditScreen id={id} onBack={() => setRoute(id === null ? TABS_ROUTE : { name: 'entry', id })} onSaved={(saved) => setRoute({ name: 'entry', id: saved })} onLocked={refresh} />;
  }
  if (route.name === 'import') return <ImportScreen onBack={home} onDone={home} onLocked={refresh} />;
  if (route.name === 'password') return <ChangePasswordScreen onBack={home} onDone={finishFlow} onLocked={refresh} />;
  if (route.name === 'fingerprint') return <FingerprintScreen onBack={home} onDone={finishFlow} onLocked={refresh} />;
  if (route.name === 'newKey') {
    return <NewRecoveryKeyScreen shown={route.key} onKey={(key) => setRoute({ name: 'newKey', key })} onBack={home} onDone={finishFlow} onLocked={refresh} />;
  }

  return (
    <>
      <View style={{ flex: 1 }}>
        {tab === 'vault' ? (
          <VaultScreen
            status={status}
            refresh={refresh}
            view={view}
            onView={setView}
            onOpen={(id) => setRoute({ name: 'entry', id })}
            onAdd={() => setRoute({ name: 'edit', id: null })}
          />
        ) : (
          <SettingsScreen status={status} refresh={refresh} notice={notice} onOpen={openFlow} />
        )}
      </View>
      <TabBar
        tabs={TABS}
        value={tab}
        onChange={(next) => {
          if (deriving()) return;
          setNotice(null);
          setTab(next);
        }}
      />
    </>
  );
}
