const DAY_MS = 24 * 60 * 60 * 1000;
// Each photo costs one on-device OCR pass, so only the nearest are read.
export const RECEIPT_WINDOW = { beforeMs: 3 * DAY_MS, afterMs: DAY_MS };
export const MAX_PHOTOS_READ = 40;

export const receiptWindow = (at: number): { from: number; to: number } => ({
  from: at - RECEIPT_WINDOW.beforeMs,
  to: at + RECEIPT_WINDOW.afterMs,
});

const NUMBER = /\d{1,3}(?:[,\s]\d{3})+(?:\.\d{1,2})?(?!\d)|\d+(?:\.\d{1,2})?/g;

export function amountsIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const major = Number(m[0].replace(/[,\s]/g, ''));
    if (Number.isFinite(major)) out.push(Math.round(major * 100));
  }
  return out;
}

// Words of four letters or more: short ones ("the", "Pay") match almost anything.
const nameWords = (name: string): string[] =>
  name.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 4);

export interface ReceiptMatch { amountMatch: boolean; nameMatch: boolean; score: number }

export function matchReceipt(text: string, txn: { amount: number; counterparty: string | null }): ReceiptMatch {
  const amountMatch = amountsIn(text).includes(txn.amount);
  const lower = text.toLowerCase();
  const nameMatch = txn.counterparty !== null && nameWords(txn.counterparty).some((w) => lower.includes(w));
  return { amountMatch, nameMatch, score: (amountMatch ? 2 : 0) + (nameMatch ? 1 : 0) };
}
