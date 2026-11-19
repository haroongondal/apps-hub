import { requireNativeModule } from 'expo';

interface AiHubCoreApi {
  apiVersion(): number;
}

const native = requireNativeModule<AiHubCoreApi>('AiHubCore');

/** The native contract version, so the JS side can refuse a stale build. */
export function apiVersion(): number {
  const v = native.apiVersion();
  return typeof v === 'number' && Number.isInteger(v) ? v : 0;
}
