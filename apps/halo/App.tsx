import React, { useEffect, useState } from 'react';
import { AppState, BackHandler, View } from 'react-native';
import { TabBar, ThemeProvider } from '@apps-hub/ui';
import HaloEngine from 'halo-engine';
import ColoursScreen from './src/ColoursScreen.tsx';
import DiagnosticsScreen from './src/DiagnosticsScreen.tsx';
import EdgesScreen from './src/EdgesScreen.tsx';
import HomeScreen from './src/HomeScreen.tsx';
import LightsScreen from './src/LightsScreen.tsx';
import { useSettings } from './src/useSettings.ts';

type Tab = 'home' | 'lights' | 'colours';
type Route = 'tabs' | 'edges' | 'diagnostics';

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'home', label: 'Home' },
  { key: 'lights', label: 'Lights' },
  { key: 'colours', label: 'Colours' },
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
  const [active, setActive] = useState(AppState.currentState !== 'background');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route === 'tabs') return false;
      setRoute('tabs');
      return true;
    });
    return () => sub.remove();
  }, [route]);

  // The screens that change the look show it live on the edges, even with the lights switched off.
  const previewing = active && (route === 'edges' || (route === 'tabs' && tab !== 'home'));
  useEffect(() => {
    HaloEngine.setPreview(previewing);
  }, [previewing]);

  const back = () => setRoute('tabs');
  if (route === 'edges') return <EdgesScreen settings={settings} update={update} onBack={back} />;
  if (route === 'diagnostics') return <DiagnosticsScreen onBack={back} />;

  return (
    <>
      <View style={{ flex: 1 }}>
        {tab === 'home' && <HomeScreen settings={settings} update={update} onOpen={setRoute} />}
        {tab === 'lights' && <LightsScreen settings={settings} update={update} />}
        {tab === 'colours' && <ColoursScreen settings={settings} update={update} />}
      </View>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
    </>
  );
}
