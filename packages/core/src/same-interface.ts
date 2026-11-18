import type { InterfaceInfo } from './model.ts';

/** True when both describe the same Wi-Fi address, so state holding it can keep the old object. */
export function sameInterface(a: InterfaceInfo | null, b: InterfaceInfo | null): boolean {
  return a === b || (a !== null && b !== null && a.localIp === b.localIp && a.gatewayIp === b.gatewayIp && a.cidrPrefix === b.cidrPrefix);
}
