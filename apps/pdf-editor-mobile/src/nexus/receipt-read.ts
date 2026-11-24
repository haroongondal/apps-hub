import type { ImageFile, NexusAi } from './hub-first.ts';
import { parseReceiptReply, receiptMessages, type Receipt, type ReceiptResult } from './receipt-parse.ts';

export type ReceiptReader = Pick<NexusAi, 'readImage' | 'complete'>;

/** The photo goes through the usual image read; only the text it gives back, inside a fixed prompt, is sent on to get the fields. */
export async function readReceipt(port: ReceiptReader, file: ImageFile, now: number = Date.now()): Promise<ReceiptResult> {
  const { system, user } = receiptMessages(await port.readImage(file));
  return parseReceiptReply(await port.complete(system, user, true), now);
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
