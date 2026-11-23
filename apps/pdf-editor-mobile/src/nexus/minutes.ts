import { ai } from './ai';
import { emit, kick, openKnowledge } from './worker';

// Held here, not in the screen, so leaving and reopening an item shows its minutes still being made and a second tap joins the first run.
const making = new Map<string, Promise<void>>();

export const isMakingMinutes = (itemId: string): boolean => making.has(itemId);

export function makeMinutes(itemId: string): Promise<void> {
  const running = making.get(itemId);
  if (running) return running;
  const run = openKnowledge()
    .then((kn) => kn.makeMinutes(itemId, (system, user) => ai.complete(system, user, true)))
    .then(() => void kick().catch(() => {})) // embeds the new minutes for Ask; if this fails the queued job runs on the next start
    .finally(() => {
      making.delete(itemId);
      emit();
    });
  making.set(itemId, run);
  emit();
  return run;
}
