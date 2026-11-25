import type { Txn } from 'inflow-core';
import { MAX_PHOTOS_READ, matchReceipt } from './receipts.ts';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
// A payment screenshot is taken at or after the payment; older transactions are left to the Find receipt row.
export const AUTO = { lookbackMs: 3 * DAY, beforeMs: 30 * MIN, afterMs: DAY, readsPerRun: 12 };

// Words a payment confirmation screen shows; an amount alone also matches a balance or a price.
const PAID = /\b(?:success\w*|sent|paid|payment|transfer\w*|transaction|receipt|raast)\b/i;
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface Photo { uri: string; takenAt: number }

type Wanted = Pick<Txn, 'amount' | 'counterparty' | 'txId' | 'at'>;

/** The photo to attach, or null. The amount must be on it, plus the Tx ID, the name or a payment word; the nearest to the payment wins. */
export function autoChoice(read: Array<Photo & { text: string }>, txn: Wanted): string | null {
  let best: { uri: string; strength: number; gap: number } | null = null;
  const id = txn.txId !== null && txn.txId.length >= 6 ? squash(txn.txId) : null;
  for (const p of read) {
    const m = matchReceipt(p.text, txn);
    if (!m.amountMatch) continue;
    const idMatch = id !== null && squash(p.text).includes(id);
    const strength = (m.nameMatch ? 1 : 0) + (idMatch ? 1 : 0) + (PAID.test(p.text) ? 1 : 0);
    if (strength === 0) continue;
    const gap = Math.abs(p.takenAt - txn.at);
    if (best === null || strength > best.strength || (strength === best.strength && gap < best.gap)) best = { uri: p.uri, strength, gap };
  }
  return best?.uri ?? null;
}

export interface AutoPorts {
  now(): number;
  // Newest first.
  recentOut(): Txn[];
  hasReceipt(t: Txn): boolean;
  photos(from: number, to: number): Photo[];
  read(uri: string): Promise<string>;
  attach(itemId: number, uri: string): void;
}

/** Looks for a screenshot of each recent payment that has none yet and attaches the one that matches. Returns how many it attached. */
export async function runAutoReceipts(ports: AutoPorts, cache: Map<string, string>, alive: () => boolean): Promise<number> {
  const now = ports.now();
  let reads = 0;
  let attached = 0;
  for (const t of ports.recentOut()) {
    if (!alive()) break;
    if (t.at < now - AUTO.lookbackMs) break;
    if (t.direction !== 'out' || t.itemIds.length === 0 || ports.hasReceipt(t)) continue;
    const photos = ports.photos(t.at - AUTO.beforeMs, Math.min(t.at + AUTO.afterMs, now)).sort((a, b) => b.takenAt - a.takenAt).slice(0, MAX_PHOTOS_READ);
    const read: Array<Photo & { text: string }> = [];
    for (const p of photos) {
      let text = cache.get(p.uri);
      if (text === undefined) {
        if (reads >= AUTO.readsPerRun) return attached;
        reads++;
        try {
          text = await ports.read(p.uri);
        } catch {
          text = '';   // a photo that cannot be read is not tried again until the app restarts
        }
        cache.set(p.uri, text);
        if (!alive()) return attached;
      }
      read.push({ ...p, text });
    }
    const uri = autoChoice(read, t);
    if (uri === null) continue;
    try {
      ports.attach(t.itemIds[0], uri);
      attached++;
    } catch {
      // Already saved or unreadable: the Find receipt row still works by hand.
    }
  }
  return attached;
}
