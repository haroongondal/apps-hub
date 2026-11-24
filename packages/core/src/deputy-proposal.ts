// HomeNet's fixed words only: no credentials, no address, nothing read from other devices or typed by other people.
export const ROUTER_RESTART_TASK =
  'Restart my router: open the router app or its admin page, find Restart or Reboot, and restart it.';

export interface DeputyProposal {
  task: string;
  context: string;
}

export type DeputyProposalOutcome = 'handed_over' | 'cancelled' | 'not_installed' | 'refused' | 'invalid' | 'busy' | 'not_supported';

export interface DeputyBinding {
  proposeDeputyTask(proposal: DeputyProposal): Promise<DeputyProposalOutcome>;
}

// Context stays empty: the router's UPnP name and model are text the router itself sends, not HomeNet's.
export function routerRestartProposal(): DeputyProposal {
  return { task: ROUTER_RESTART_TASK, context: '' };
}

export function proposalExtras(p: DeputyProposal): Record<string, string> {
  return p.context.trim() === '' ? { task: p.task } : { task: p.task, context: p.context };
}

const OUTCOMES: readonly DeputyProposalOutcome[] = ['handed_over', 'cancelled', 'not_installed', 'refused', 'invalid', 'busy'];

export function parseDeputyOutcome(raw: unknown): DeputyProposalOutcome {
  if (typeof raw !== 'object' || raw === null || (raw as Record<string, unknown>).supported !== true) return 'not_supported';
  const outcome = (raw as Record<string, unknown>).outcome;
  return OUTCOMES.find((o) => o === outcome) ?? 'refused';
}

export function deputyOutcomeMessage(outcome: DeputyProposalOutcome): string | null {
  switch (outcome) {
    case 'handed_over':
      return 'The task is in Deputy. Check it there and tap Start when you are ready.';
    case 'cancelled':
      return null;
    case 'not_installed':
      return 'Deputy isn’t installed, or it needs an update. Get it from the Store, then try again.';
    case 'not_supported':
      return 'Deputy works only on Android phones.';
    case 'busy':
      return 'Deputy is already open with a task. Finish or close it first.';
    case 'refused':
    case 'invalid':
      return 'Deputy didn’t take the task. Update HomeNet and Deputy from the Store, then try again.';
  }
}
