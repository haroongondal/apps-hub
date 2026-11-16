import { requireNativeModule } from 'expo';

export interface HaloEngineApi {
  /** Scaffold check: returns "halo" once the native module is linked. */
  ping(): string;
}

export default requireNativeModule<HaloEngineApi>('HaloEngine');
