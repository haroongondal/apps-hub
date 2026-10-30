import React, { useCallback, useEffect, useState } from 'react';
import { AppState, BackHandler, View } from 'react-native';
import { TabBar, ThemeProvider, palette } from '@apps-hub/ui';
import Vault from 'strongroom-vault';
import { deriving } from './src/call.ts';
import { EditScreen } from './src/EditScreen.tsx';
import { EntryScreen } from './src/EntryScreen.tsx';
import { ImportScreen } from './src/ImportScreen.tsx';
import { SettingsScreen } from './src/SettingsScreen.tsx';
import { SetupScreen } from './src/SetupScreen.tsx';
import { UnlockScreen } from './src/UnlockScreen.tsx';
import { VaultScreen, type VaultView } from './src/VaultScreen.tsx';

type Tab = 'vault' | 'settings';
type Route = { name: 'tabs' } | { name: 'entry'; id: string } | { name: 'edit'; id: string | null } | { name: 'import' };

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'vault', label: 'Vault' },
  { key: 'settings', label: 'Settings' },
];

const TABS_ROUTE: Route = { name: 'tabs' };

export default function App() {
  return (
    <ThemeProvider brand="strongroom">
      <Home />
    </ThemeProvider>
  );
}

function Home() {
  const [status, setStatus] = useState(() => Vault.getStatus());
  const [settingUp, setSettingUp] = useState(!status.setUp);
  const [tab, setTab] = useState<Tab>('vault');
  const [route, setRoute] = useState<Route>(TABS_ROUTE);
  const [view, setView] = useState<VaultView>({ kind: 'login', query: '' });

  // Never while a key derivation is pending: the bridge's sync calls would wait on it.
  const refresh = useCallback(() => {
    if (!deriving()) setStatus(Vault.getStatus());
  }, []);

  useEffect(() => Vault.setPalette(JSON.stringify({ light: palette('strongroom', 'light'), dark: palette('strongroom', 'dark') })), []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);
  useEffect(() => {
    if (!status.unlocked) setRoute(TABS_ROUTE);
  }, [status.unlocked]);
  useEffect(() => {
    if (route.name === 'tabs') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setRoute(route.name === 'edit' && route.id !== null ? { name: 'entry', id: route.id } : TABS_ROUTE);
      return true;
    });
    return () => sub.remove();
  }, [route]);

  const home = () => setRoute(TABS_ROUTE);

  if (settingUp) {
    return (
      <SetupScreen
        status={status}
        onFinished={() => {
          setSettingUp(false);
          refresh();
        }}
      />
    );
  }
  if (!status.unlocked) return <UnlockScreen status={status} onUnlocked={refresh} />;

  if (route.name === 'entry') {
    return <EntryScreen id={route.id} onBack={home} onEdit={() => setRoute({ name: 'edit', id: route.id })} onLocked={refresh} />;
  }
  if (route.name === 'edit') {
    const { id } = route;
    return <EditScreen id={id} onBack={() => setRoute(id === null ? TABS_ROUTE : { name: 'entry', id })} onSaved={(saved) => setRoute({ name: 'entry', id: saved })} onLocked={refresh} />;
  }
  if (route.name === 'import') return <ImportScreen onBack={home} onDone={home} onLocked={refresh} />;

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
          <SettingsScreen status={status} refresh={refresh} onImport={() => setRoute({ name: 'import' })} />
        )}
      </View>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
    </>
  );
}
