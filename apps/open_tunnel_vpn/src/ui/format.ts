/**
 * Presentation formatters shared by the phase-4 screens. Pure TypeScript:
 * no React imports, so the helpers stay unit-testable on Node.
 */
import type { VpnNode } from 'open-tunnel-core';

/** Bytes moved in the last tick — reads like a network meter, not a file size. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${Math.round(bytes)} B`;
}

/** Connected duration; native ticks carry whole seconds. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0 s';
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${secs} s`;
  return `${secs} s`;
}

/** Countries render as the ISO code plus the upstream long name — never
 * flag emoji (repo copy rules). The long name is optional upstream data. */
export function countryLabel(node: VpnNode): string {
  const code = countryCode(node);
  return node.countryLong ? `${code} · ${node.countryLong}` : code;
}

export interface CountryOption {
  code: string;
  label: string;
  count: number;
}

export function countryCode(node: VpnNode): string {
  return node.countryShort || '--';
}

/** One entry per country in the list, most relays first. */
export function countryOptions(nodes: readonly VpnNode[]): CountryOption[] {
  const byCode = new Map<string, CountryOption>();
  for (const node of nodes) {
    const code = countryCode(node);
    const option = byCode.get(code) ?? { code, label: countryLabel(node), count: 0 };
    option.count += 1;
    byCode.set(code, option);
  }
  return [...byCode.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

/** Server-list row line: measured RTT once probed, upstream static ping
 * until then (honest provenance, phase-4 plan §5). */
export function rttLabel(node: VpnNode): string {
  if (node.measuredRttMs !== null) return `${Math.round(node.measuredRttMs)} ms measured`;
  return `${Math.round(node.pingMs)} ms listed`;
}

/** Round MB/s figure from the CSV bits-per-second speed column. */
export function speedLabel(node: VpnNode): string {
  const mbps = node.speedBps / 1_000_000;
  return mbps >= 10 ? `${mbps.toFixed(0)} Mbps` : `${mbps.toFixed(1)} Mbps`;
}

/** Fitness shown only once the prober (or a previous session) measured it;
 * zero means "not probed yet" — the honest blank state. */
export function fitnessLabel(node: VpnNode): string {
  if (node.fitnessScore === 0 && node.measuredRttMs === null) return 'fitness — not probed';
  return `fitness ${node.fitnessScore.toFixed(1)}`;
}
