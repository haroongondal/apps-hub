import { TabBar } from '@apps-hub/ui';
import { Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

type Key = 'index' | 'library' | 'cv';
const TABS: { key: Key; label: string }[] = [
  { key: 'index', label: 'Stream' },
  { key: 'library', label: 'Library' },
  { key: 'cv', label: 'CV' },
];

// adjustResize lifts everything at the bottom above the keyboard, tabs included; a custom
// tabBar skips the navigator's tabBarHideOnKeyboard, so hide it here while typing.
function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setShown(true));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}

export default function TabsLayout() {
  const keyboardShown = useKeyboardShown();
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={({ state, navigation }) =>
        keyboardShown ? null : (
          <TabBar tabs={TABS} value={state.routes[state.index].name as Key} onChange={(key) => navigation.navigate(key)} />
        )
      }
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="library" />
      <Tabs.Screen name="cv" />
    </Tabs>
  );
}
