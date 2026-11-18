import { requireNativeModule } from 'expo';

interface NotchIslandModule {
  canDrawOverlay(): boolean;
  isRunning(): boolean;
  setEnabled(on: boolean): boolean;
  openOverlaySettings(): void;
}

export default requireNativeModule<NotchIslandModule>('NotchIsland');
