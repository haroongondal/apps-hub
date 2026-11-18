import { scanLine } from './view.ts';

export const scanText = (indexed: number, state: string | undefined, progress: number | null): string =>
  state === 'queued' ? 'Waiting for other work to finish' : scanLine(indexed, progress);

export const noMatches = (similar: boolean) => ({
  title: 'No close matches',
  body: similar ? 'No other photos look much like this one.' : 'Try other words.',
});
