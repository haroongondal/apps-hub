import type { Draft } from 'deputy-agent';

const PREVIEW = 80;

export function draftRow(d: Pick<Draft, 'instruction' | 'text' | 'subject'> & { source?: string | null }): { title: string; subtitle: string } {
  const first = (d.subject ?? d.text).split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
  const preview = first.length > PREVIEW ? `${first.slice(0, PREVIEW - 1).trimEnd()}…` : first;
  return { title: d.instruction.trim() || 'No task written yet', subtitle: d.source ? `Suggested by ${d.source}` : `Shared text: ${preview}` };
}

/** Copy for the draft sheet. A suggested task says which app suggested it, so the owner knows the words are not theirs. */
export function sheetCopy(d: { id: string | null; source: string | null }): { title: string; label: string; hint: string | undefined } {
  if (d.source) return { title: 'Suggested task', label: 'What should Deputy do?', hint: `Suggested by ${d.source}. Change it as you like before you tap Start.` };
  return { title: d.id ? 'Draft task' : 'New task from shared text', label: 'What should Deputy do with this text?', hint: undefined };
}
