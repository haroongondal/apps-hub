import type { ReminderTrigger } from 'place-reminders';

export const RADIUS_CHOICES = [100, 250, 500, 1000] as const;

export function formatRadius(metres: number): string {
  return metres >= 1000 ? `${metres / 1000} km` : `${metres} m`;
}

export function describePlace(reminder: { trigger: ReminderTrigger; radiusM: number }): string {
  const when = reminder.trigger === 'arrive' ? 'When I arrive' : 'When I leave';
  return `${when}, within ${formatRadius(reminder.radiusM)}`;
}
