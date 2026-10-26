/**
 * open-tunnel-core — pure TypeScript domain logic for OpenTunnel.
 * No React/RN/node-only imports; runs on Hermes (RN), Node, and Electron.
 * TCP probing is injected (`TcpProbeFn`); see src/node-tcp-probe.ts for the
 * Node-side implementation (not exported here — it needs node:net).
 */
export * from './vpn-node.ts';
export * from './vpngate.ts';
export * from './vpngate-service.ts';
export * from './latency-prober.ts';
export * from './fitness.ts';
