import type { AppInfo, JobKey, ServiceKey } from 'ai-hub-core';

export const STRONGROOM = 'com.haroon.strongroom';
export const BLOCKED_TEXT = 'Blocked: passwords never leave Strongroom.';
export const KEYS_UNREADABLE = "Your saved keys couldn't be opened";

export const SERVICE_LABEL: Record<ServiceKey, string> = { groq: 'Groq', gemini: 'Gemini' };

export const JOBS: ReadonlyArray<{ key: JobKey; label: string }> = [
  { key: 'chat', label: 'Chat' },
  { key: 'vision', label: 'Images' },
  { key: 'embed', label: 'Embeddings' },
  { key: 'transcribe', label: 'Transcription' },
];

export function servicesFor(job: JobKey): ServiceKey[] {
  if (job === 'chat') return ['groq', 'gemini'];
  return job === 'transcribe' ? ['groq'] : ['gemini'];
}

export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  const [value, unit] = n < 1_000_000 ? [n / 1000, 'k'] : [n / 1_000_000, 'M'];
  return `${value.toFixed(1).replace(/\.0$/, '')}${unit}`;
}

export function lastUsedText(ms: number, now: number): string {
  if (ms <= 0) return 'Never used';
  const minutes = Math.floor((now - ms) / 60_000);
  if (minutes < 1) return 'Used just now';
  if (minutes < 60) return `Used ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Used ${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `Used ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export function usageText(app: Pick<AppInfo, 'calls' | 'inputTokens' | 'outputTokens'>): string {
  if (app.calls === 0) return 'No calls yet';
  const calls = `${formatCount(app.calls)} ${app.calls === 1 ? 'call' : 'calls'}`;
  return `${calls}, ${formatCount(app.inputTokens)} tokens in, ${formatCount(app.outputTokens)} out`;
}

// Expo wraps a native failure as "Call to function ... rejected.\n→ Caused by: <message>".
// Native errors arrive as "java.lang.IllegalArgumentException: <message>"; people should only see the message.
const JVM_CLASS = /^\s*(?:[a-z_][\w$]*\.)+[A-Z][\w$]*(?:Exception|Error):\s*/;

export function plainError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  const cause = (text.split('Caused by: ').pop() ?? text).replace(JVM_CLASS, '');
  return cause.trim() || 'Something went wrong. Try again.';
}

export const keysUnreadable = (message: string): boolean => message.startsWith(KEYS_UNREADABLE);
