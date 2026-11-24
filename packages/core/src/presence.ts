// A phone that sleeps its Wi-Fi misses a check now and then, so a person turns away only after
// AWAY_AFTER_MISSES misses in a row. Kotlin twin: Presence.next; both run fixtures/presence-cases.json.

export const AWAY_AFTER_MISSES = 3;

export interface PresenceState {
  present: boolean;
  misses: number;
  lastSeenAt: number;
}

export const UNKNOWN_PRESENCE: PresenceState = { present: false, misses: AWAY_AFTER_MISSES, lastSeenAt: 0 };

export function nextPresence(
  prev: PresenceState,
  answered: boolean,
  now: number,
  awayAfter: number = AWAY_AFTER_MISSES,
): PresenceState {
  if (answered) return { present: true, misses: 0, lastSeenAt: Math.max(prev.lastSeenAt, now) };
  const misses = prev.misses + 1;
  return { present: prev.present && misses < awayAfter, misses, lastSeenAt: prev.lastSeenAt };
}
