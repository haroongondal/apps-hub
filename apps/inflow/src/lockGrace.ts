// While Health Connect's permission screen is open the app goes to the background; that one trip must not lock the app. A forgotten flag expires, so it can never keep the app unlocked.
export const PROMPT_GRACE_MS = 2 * 60 * 1000;

let startedAt: number | null = null;

export function beginPermissionPrompt(now: number): void {
  startedAt = now;
}

export function endPermissionPrompt(): void {
  startedAt = null;
}

export function permissionPromptOpen(now: number): boolean {
  return startedAt !== null && now >= startedAt && now - startedAt < PROMPT_GRACE_MS;
}
