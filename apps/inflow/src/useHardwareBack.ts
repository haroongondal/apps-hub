import { useEffect } from 'react';
import { BackHandler } from 'react-native';

// Handlers run newest first, so a sub-screen that a tab opens by itself gets the back key before the app's own handler.
export function useHardwareBack(onBack: () => void): void {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);
}
