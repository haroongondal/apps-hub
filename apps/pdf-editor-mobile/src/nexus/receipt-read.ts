import type { ImageFile, NexusAi } from './hub-first.ts';
import { parseReceiptReply, receiptMessages, type ReceiptResult } from './receipt-parse.ts';

export type ReceiptReader = Pick<NexusAi, 'readImage' | 'complete'>;

/** The photo goes through the usual image read; only the text it gives back, inside a fixed prompt, is sent on to get the fields. */
export async function readReceipt(port: ReceiptReader, file: ImageFile, now: number = Date.now()): Promise<ReceiptResult> {
  const { system, user } = receiptMessages(await port.readImage(file));
  return parseReceiptReply(await port.complete(system, user, true), now);
}

