export interface InflowTodo {
  title: string;
  note: string;
  source: string;
}

export type InflowOutcome = 'added' | 'cancelled' | 'not_installed' | 'refused' | 'busy';

export function ibanTodo(formattedIban: string): InflowTodo {
  return { title: `Pay account ${formattedIban}`, note: 'From Clipboard', source: 'Clipboard' };
}

const OUTCOMES: readonly InflowOutcome[] = ['added', 'cancelled', 'not_installed', 'refused', 'busy'];

export function parseInflowOutcome(raw: unknown): InflowOutcome {
  return OUTCOMES.find((o) => o === raw) ?? 'refused';
}

export function inflowOutcomeMessage(outcome: InflowOutcome): { text: string; tone: 'ok' | 'warn' } | null {
  switch (outcome) {
    case 'added':
      return { text: 'Added to your to-dos in Inflow.', tone: 'ok' };
    case 'cancelled':
      return { text: 'Nothing was added to Inflow.', tone: 'ok' };
    case 'busy':
      return null;
    case 'not_installed':
      return { text: 'Inflow isn’t installed, or it needs an update. Get it from the Store, then try again.', tone: 'warn' };
    case 'refused':
      return { text: 'Inflow didn’t take the to-do. Update Clipboard and Inflow from the Store, then try again.', tone: 'warn' };
  }
}
