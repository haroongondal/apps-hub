import { TabBar } from '@apps-hub/ui';
import { Tabs } from 'expo-router';

import { isBusy, useQueue } from '../../src/media/queue';

type Key = 'index' | 'media' | 'queue';

export default function TabsLayout() {
  const running = useQueue().filter(isBusy).length;
  const tabs = [
    { key: 'index' as Key, label: 'Designs' },
    { key: 'media' as Key, label: 'Media' },
    { key: 'queue' as Key, label: running ? `Queue (${running})` : 'Queue' },
  ];
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={({ state, navigation }) => (
        <TabBar tabs={tabs} value={state.routes[state.index].name as Key} onChange={key => navigation.navigate(key)} />
      )}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="media" />
      <Tabs.Screen name="queue" />
    </Tabs>
  );
}
