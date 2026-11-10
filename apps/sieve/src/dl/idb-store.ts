import type { DlRecord } from '@apps-hub/sieve-core/src/dl-record.ts';
import type { Store } from '@apps-hub/sieve-core/src/dl-ports.ts';

export function openStore(): Promise<Store> {
  throw new Error('not implemented');
}

export async function readAllRecords(): Promise<DlRecord[]> {
  throw new Error('not implemented');
}
