import { TabBar } from '@apps-hub/ui';
import { Tabs } from 'expo-router';

type Key = 'index' | 'library' | 'cv';
const TABS: { key: Key; label: string }[] = [
  { key: 'index', label: 'Stream' },
  { key: 'library', label: 'Library' },
  { key: 'cv', label: 'CV' },
];

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={({ state, navigation }) => (
        <TabBar tabs={TABS} value={state.routes[state.index].name as Key} onChange={(key) => navigation.navigate(key)} />
      )}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="library" />
      <Tabs.Screen name="cv" />
    </Tabs>
  );
}
