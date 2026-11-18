import { requireNativeModule } from 'expo';

interface NotchIslandModule {
  isRunning(): boolean;
  openAccessibilitySettings(): void;
}

export default requireNativeModule<NotchIslandModule>('NotchIsland');
