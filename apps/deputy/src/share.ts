import type { Draft } from 'deputy-agent';

const PREVIEW = 80;

export function draftRow(d: Pick<Draft, 'instruction' | 'text' | 'subject'>): { title: string; subtitle: string } {
  const first = (d.subject ?? d.text).split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
  const preview = first.length > PREVIEW ? `${first.slice(0, PREVIEW - 1).trimEnd()}…` : first;
  return { title: d.instruction.trim() || 'No task written yet', subtitle: `Shared text: ${preview}` };
}
