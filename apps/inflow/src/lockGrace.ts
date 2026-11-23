// While Health Connect's permission screen is open the app goes to the background; that one trip must not lock the app. A forgotten flag expires, so it can never keep the app unlocked.
export const PROMPT_GRACE_MS = 2 * 60 * 1000;

let startedAt: number | null = null;
let skippedAt: number | null = null;

export function beginPermissionPrompt(now: number): void {
  startedAt = now;
  skippedAt = null;
}

export function endPermissionPrompt(): void {
  startedAt = null;
}

export function permissionPromptOpen(now: number): boolean {
  return startedAt !== null && now >= startedAt && now - startedAt < PROMPT_GRACE_MS;
}

export type LockDecision = 'lock' | 'keep' | 'none';

// A skipped background has to be judged when the app comes back: leaving the picker by Home or screen-off sends no second background event.
export function appStateDecision(state: string, now: number): LockDecision {
  if (state === 'background') return backgroundDecision(now);
  if (state === 'active') return activeDecision(now);
  return 'none';
}

function backgroundDecision(now: number): LockDecision {
  if (!permissionPromptOpen(now)) {
    skippedAt = null;
    return 'lock';
  }
  skippedAt ??= now;
  return 'keep';
}

function activeDecision(now: number): LockDecision {
  if (skippedAt === null) return 'none';
  const waited = now - skippedAt;
  skippedAt = null;
  return waited >= 0 && waited < PROMPT_GRACE_MS ? 'keep' : 'lock';
}
