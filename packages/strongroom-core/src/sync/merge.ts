import { equalBytes } from '../crypto.ts';
import type { Entry } from '../entry.ts';

// entry is null when the record does not decrypt.
export type MergeLocal = { id: string; rev: number; dirty: boolean; sealed: Uint8Array; entry: Entry | null };
export type MergeRemote = { id: string; rev: number; sealed: Uint8Array; entry: Entry | null };
// rebase: records whose base moves to a newer server rev while their bytes stay (a local winner, a kept unreadable copy), so a later push isn't stale.
export type MergePlan = {
  adopt: MergeRemote[];
  push: { id: string; baseRev: number }[];
  quarantine: MergeRemote[];
  blocked: string[];
  rebase: { id: string; rev: number }[];
  conflicts: number;
};

// Last writer wins on updatedAt; on a tie the tombstone wins, otherwise the remote, so every device picks the same side.
const localWins = (l: Entry, r: Entry): boolean =>
  l.updatedAt !== r.updatedAt ? l.updatedAt > r.updatedAt : l.type === 'deleted' && r.type !== 'deleted';

export function planMerge(local: MergeLocal[], remote: MergeRemote[]): MergePlan {
  const plan: MergePlan = { adopt: [], push: [], quarantine: [], blocked: [], rebase: [], conflicts: 0 };
  const mine = new Map(local.map((l) => [l.id, l]));
  const handled = new Set<string>();
  for (const r of remote) {
    const l = mine.get(r.id);
    if (l && !l.entry) {
      plan.blocked.push(r.id); // a local copy that does not open is kept as is: never overwritten, never pushed
      if (!r.entry) plan.quarantine.push(r);
      else if (r.rev > l.rev) plan.rebase.push({ id: r.id, rev: r.rev });
    } else if (l && equalBytes(l.sealed, r.sealed)) {
      plan.adopt.push(r); // our own push that committed but was never marked done
    } else if (!r.entry) {
      plan.quarantine.push(r);
      plan.blocked.push(r.id);
    } else if (l && r.rev <= l.rev) {
      continue; // not newer than the version this copy is based on, so nothing changed remotely
    } else if (!l || !l.dirty) {
      plan.adopt.push(r);
    } else {
      plan.conflicts++;
      if (localWins(l.entry!, r.entry)) {
        plan.push.push({ id: r.id, baseRev: r.rev });
        plan.rebase.push({ id: r.id, rev: r.rev });
      } else plan.adopt.push(r);
    }
    handled.add(r.id);
  }
  for (const l of local) {
    if (handled.has(l.id)) continue;
    if (!l.entry) plan.blocked.push(l.id);
    else if (l.dirty) plan.push.push({ id: l.id, baseRev: l.rev });
  }
  return plan;
}
