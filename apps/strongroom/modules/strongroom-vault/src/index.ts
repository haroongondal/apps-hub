import { requireNativeModule } from 'expo';

export interface StrongroomVaultApi {
  /** Scaffold check: returns "ok" once the native module is linked. */
  ping(): string;
}

export default requireNativeModule<StrongroomVaultApi>('StrongroomVault');
