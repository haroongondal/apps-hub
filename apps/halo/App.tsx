import React, { useEffect, useState } from 'react';
import { AppState, BackHandler, View } from 'react-native';
import { TabBar, ThemeProvider } from '@apps-hub/ui';
import HaloEngine from 'halo-engine';
import ColoursScreen from './src/ColoursScreen.tsx';
import DiagnosticsScreen from './src/DiagnosticsScreen.tsx';
import EdgesScreen from './src/EdgesScreen.tsx';
import HomeScreen from './src/HomeScreen.tsx';
import LightsScreen from './src/LightsScreen.tsx';
import NotificationsScreen from './src/NotificationsScreen.tsx';
import AodScreen from './src/AodScreen.tsx';
import AppPicker from './src/AppPicker.tsx';
import RulesScreen from './src/RulesScreen.tsx';
import ThemeScreen from './src/ThemeScreen.tsx';
import IslandScreen from './src/IslandScreen.tsx';
import LinksScreen from './src/LinksScreen.tsx';
import { useSettings } from './src/useSettings.ts';

type Tab = 'home' | 'lights' | 'notch' | 'notifications' | 'aod';
type Route = 'tabs' | 'edges' | 'diagnostics' | 'rules' | 'appPicker' | 'colours' | 'theme' | 'links';

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'home', label: 'Home' },
  { key: 'lights', label: 'Lights' },
  { key: 'notch', label: 'Notch' },
  { key: 'notifications', label: 'Alerts' },
  { key: 'aod', label: 'Screen' },
];

export default function App() {
  return (
    <ThemeProvider brand="halo">
      <Main />
    </ThemeProvider>
  );
}

function Main() {
  const [settings, update] = useSettings();
  const [tab, setTab] = useState<Tab>('home');
  const [route, setRoute] = useState<Route>('tabs');
  const [themeId, setThemeId] = useState('');
  const [active, setActive] = useState(AppState.currentState !== 'background');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  // The app picker opens from the rules screen, so Back returns there.
  const back = () => setRoute(route === 'appPicker' ? 'rules' : 'tabs');
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route === 'tabs') return false;
      setRoute(route === 'appPicker' ? 'rules' : 'tabs');
      return true;
    });
    return () => sub.remove();
  }, [route]);

  // The screens that change the look show it live on the edges, even with the lights switched off.
  // Notifications and rules stay out: a preview would hide the flashes being tried.
  const previewing = active && (route === 'edges' || route === 'colours' || (route === 'tabs' && tab === 'lights'));
  useEffect(() => {
    HaloEngine.setPreview(previewing);
  }, [previewing]);

  if (route === 'edges') return <EdgesScreen settings={settings} update={update} onBack={back} />;
  if (route === 'rules') return <RulesScreen settings={settings} update={update} onBack={back} onPickApps={() => setRoute('appPicker')} />;
  if (route === 'appPicker') return <AppPicker settings={settings} update={update} onBack={back} />;
  if (route === 'colours') return <ColoursScreen settings={settings} update={update} onBack={back} />;
  if (route === 'theme') return <ThemeScreen key={themeId} settings={settings} update={update} themeId={themeId} onBack={back} />;
  if (route === 'diagnostics') return <DiagnosticsScreen onBack={back} />;
  if (route === 'links') return <LinksScreen settings={settings} update={update} onBack={back} />;

  return (
    <>
      <View style={{ flex: 1 }}>
        {tab === 'home' && <HomeScreen settings={settings} update={update} onOpen={setRoute} />}
        {tab === 'lights' && <LightsScreen settings={settings} update={update} onColours={() => setRoute('colours')} />}
        {tab === 'notch' && <IslandScreen />}
        {tab === 'notifications' && <NotificationsScreen settings={settings} update={update} />}
        {tab === 'aod' && (
          <AodScreen
            settings={settings}
            update={update}
            onOpenTheme={(id) => {
              setThemeId(id);
              setRoute('theme');
            }}
          />
        )}
      </View>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
    </>
  );
}
