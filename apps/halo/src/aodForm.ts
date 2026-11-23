import type { Aod, Theme } from 'halo-engine';
import { parseTime } from './notifyForm.ts';

export type Slot = Aod['slots'][number];

export const MAX_SLOTS = 4;
export const MAX_THEMES = 20;
const TIME_ERROR = 'Use 24-hour time, like 07:00.';
const REPEAT_ERROR = 'Another slot starts at this time.';

/** One message per row as typed: a time that is not 24-hour HH:MM, or a start time another row has too. */
export function slotErrors(slots: readonly Slot[]): (string | null)[] {
  const times = slots.map((s) => parseTime(s.start));
  return times.map((t) => (t === null ? TIME_ERROR : times.filter((x) => x === t).length > 1 ? REPEAT_ERROR : null));
}

/** The slots to save: sorted by start time, or null while a row is wrong or there are more than four. */
export function commitSlots(slots: readonly Slot[]): Slot[] | null {
  if (slots.length > MAX_SLOTS || slotErrors(slots).some((e) => e !== null)) return null;
  return slots.map((s) => ({ start: parseTime(s.start) as string, themeId: s.themeId })).sort((a, b) => a.start.localeCompare(b.start));
}

/** The rows plus one at the first free full hour; null at four rows. */
export function addSlot(slots: readonly Slot[], themeId: string): Slot[] | null {
  if (slots.length >= MAX_SLOTS) return null;
  const used = new Set(slots.map((s) => s.start));
  const start = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`).find((t) => !used.has(t));
  return start ? [...slots, { start, themeId }] : null;
}

/** The lowest unused `theme-<n>`; null at 20 themes. */
export function nextThemeId(themes: readonly Theme[]): string | null {
  if (themes.length >= MAX_THEMES) return null;
  const used = new Set(themes.map((t) => t.id));
  for (let n = 1; ; n += 1) if (!used.has(`theme-${n}`)) return `theme-${n}`;
}

/** A copy of `base` as a new theme (no photo, its own lists); null at 20 themes. */
export function newTheme(themes: readonly Theme[], base: Theme): Theme | null {
  const id = nextThemeId(themes);
  if (!id) return null;
  const copy: Theme = JSON.parse(JSON.stringify(base));
  return { ...copy, id, name: `Theme ${id.slice('theme-'.length)}`, photo: false };
}

/** The themes and always-on settings without theme `id`; null for the last theme or an unknown id. */
export function removeTheme(themes: readonly Theme[], aod: Aod, id: string): { themes: Theme[]; aod: Aod } | null {
  const rest = themes.filter((t) => t.id !== id);
  if (rest.length === 0 || rest.length === themes.length) return null;
  const themeId = aod.themeId === id || !rest.some((t) => t.id === aod.themeId) ? rest[0].id : aod.themeId;
  return { themes: rest, aod: { ...aod, themeId, slots: aod.slots.filter((s) => s.themeId !== id) } };
}
