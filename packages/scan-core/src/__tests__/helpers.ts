import { mkdir, open, readFile, rename, cp, rm, stat, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import assert from 'node:assert/strict';

import { Library, serialPort } from '@apps-hub/library-core';

import { nodeRawSql } from '../../../library-core/src/__tests__/node-sql.ts';
import type { ProcessRequest, ProcessResult, ScanFiles, ScanNative } from '../types.ts';

/** SOI, a 3-component SOF0 of 1x1, EOI: enough for jpegInfo and for a PDF image stream. */
export const TINY_JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9,
]);

const total = async (path: string): Promise<number> => {
  const s = await stat(path);
  if (!s.isDirectory()) return s.size;
  let sum = 0;
  for (const name of await readdir(path)) sum += await total(resolve(path, name));
  return sum;
};

export function nodeFiles(root: string): ScanFiles {
  const at = (p: string) => resolve(root, p);
  return {
    makeDir: async (p) => void (await mkdir(at(p), { recursive: true })),
    move: (from, to) => rename(at(from), at(to)),
    copy: (from, to) => cp(at(from), at(to)),
    remove: (p) => rm(at(p), { recursive: true, force: true }),
    exists: async (p) => stat(at(p)).then(() => true, () => false),
    size: (p) => total(at(p)),
    read: async (p) => new Uint8Array(await readFile(at(p))),
    open: async (p) => {
      const handle = await open(at(p), 'w');
      return {
        write: async (bytes) => void (await handle.write(bytes)),
        close: () => handle.close(),
      };
    },
  };
}

export interface FakeNative extends ScanNative {
  processCalls: ProcessRequest[];
  sheetCalls: { front: string; back: string | null; out: string }[];
}

/** Records calls and writes tiny files; `failOnProcess` is the 1-based call that throws. */
export function fakeNative(opts: { failOnProcess?: number } = {}): FakeNative {
  const processCalls: ProcessRequest[] = [];
  const sheetCalls: FakeNative['sheetCalls'] = [];
  return {
    processCalls,
    sheetCalls,
    async processPage(req): Promise<ProcessResult> {
      processCalls.push(req);
      if (processCalls.length === opts.failOnProcess) throw new Error('decode_failed');
      await writeFile(`${req.out}.jpg`, TINY_JPEG);
      const bw = req.filter === 'bw';
      if (bw) await writeFile(`${req.out}.bits`, Uint8Array.from([120, 156, 1]));
      return { jpg: `${req.out}.jpg`, width: 1200, height: 1600, bits: bw ? `${req.out}.bits` : null, bitsWidth: bw ? 2480 : null, bitsHeight: bw ? 3508 : null };
    },
    async composeCardSheet(req) {
      sheetCalls.push(req);
      await writeFile(`${req.out}.jpg`, TINY_JPEG);
      return { jpg: `${req.out}.jpg`, width: 2480, height: 3508 };
    },
  };
}

/** A real in-memory Library on node:sqlite with a fixed clock and counting ids. */
export async function openLibrary(now = () => 1_700_000_000_000) {
  const db = serialPort(nodeRawSql());
  let n = 0;
  const lib = await Library.open(db, { now, newId: () => (++n).toString(36).padStart(16, '0') });
  return { lib, db };
}

export const latin1 = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

export function memorySink() {
  const chunks: Uint8Array[] = [];
  return {
    write: (b: Uint8Array) => void chunks.push(b.slice()),
    text: () => latin1(Uint8Array.from(chunks.flatMap((c) => Array.from(c)))),
  };
}

/** The xref of a PDF this writer made: every in-use entry points at "<n> 0 obj", startxref points at "xref". */
export function checkXref(pdf: string): number {
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)![1]);
  assert.equal(pdf.slice(start, start + 4), 'xref');
  const [, count] = /xref\n0 (\d+)\n/.exec(pdf.slice(start))!;
  const entries = pdf.slice(start).split('\n').slice(2, 2 + Number(count));
  assert.equal(entries.length, Number(count));
  entries.forEach((line, n) => {
    assert.equal(line.length + 1, 20);
    if (line.endsWith('n ')) assert.ok(pdf.startsWith(`${n} 0 obj`, Number(line.slice(0, 10))), `object ${n}`);
  });
  return Number(count);
}

