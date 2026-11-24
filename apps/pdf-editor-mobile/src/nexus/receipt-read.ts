import { AiError } from '@apps-hub/knowledge-core';

import type { ImageFile, NexusAi } from './hub-ai.ts';
import { parseReceiptReply, receiptMessages, type Receipt, type ReceiptResult } from './receipt-parse.ts';

export type ReceiptReader = Pick<NexusAi, 'readImage' | 'complete'>;

/** The photo goes through the usual image read; only the text it gives back, inside a fixed prompt, is sent on to get the fields. */
export async function readReceipt(port: ReceiptReader, file: ImageFile, now: number = Date.now()): Promise<ReceiptResult> {
  const { system, user } = receiptMessages(await port.readImage(file));
  return parseReceiptReply(await port.complete(system, user, true), now);
}


export const READ_FAILED = "Nexus couldn't read that receipt. Check the photo is clear and your connection works, then try again.";

/** A hub that needs the owner (not allowed, no key) shows its notice at once; a photo that is too big says so; anything else is the usual line. */
export function readFailure(err: unknown): Extract<ScanRead, { kind: 'no-ai' | 'failed' }> {
  if (err instanceof AiError && err.kind === 'auth') return { kind: 'no-ai' };
  if (err instanceof AiError && err.kind === 'bad_request') return { kind: 'failed', line: err.message };
  return { kind: 'failed', line: READ_FAILED };
}

export const KEPT_OUT_LINE = 'Kept out of Nexus. Add it back to read it as a receipt.';

export type ScanRead = { kind: 'kept-out' } | { kind: 'no-ai' } | { kind: 'failed'; line: string } | { kind: 'ready'; receipt: Receipt };

/** Keep out is checked here as well as on the scan's button, because a link can open the receipt screen directly. */
export async function readScanReceipt(o: { keptOut: () => Promise<boolean>; aiReady: () => Promise<boolean>; firstPage: () => Promise<ImageFile | null>; port: ReceiptReader; now?: number }): Promise<ScanRead> {
  if (await o.keptOut()) return { kind: 'kept-out' };
  if (!(await o.aiReady())) return { kind: 'no-ai' };
  const page = await o.firstPage();
  if (!page) return { kind: 'failed', line: 'This scan has no pages to read.' };
  const result = await readReceipt(o.port, page, o.now);
  return result.ok ? { kind: 'ready', receipt: result.receipt } : { kind: 'failed', line: result.reason };
}
