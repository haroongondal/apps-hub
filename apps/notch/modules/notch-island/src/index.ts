import { requireNativeModule } from 'expo';

interface NotchIslandModule {
  isRunning(): boolean;
  openAccessibilitySettings(): void;
  getSettings(): string;
  setSettings(json: string): void;
}

export default requireNativeModule<NotchIslandModule>('NotchIsland');
