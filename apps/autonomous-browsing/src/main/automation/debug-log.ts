import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

let runsDir: string | null = null;
let keepDom = false;

export function enableRunDebug(dir: string, level: string): void {
  runsDir = dir;
  keepDom = level === 'dom';
}

export function debugging(): boolean {
  return runsDir !== null;
}

export function fingerprint(value: string | null): string | null {
  if (value === null) return null;
  return createHash('sha1').update(value).digest('hex').slice(0, 12);
}

export function debugRecord(runId: string, record: Record<string, unknown>): void {
  write(runId, 'trace.jsonl', `${JSON.stringify(record)}\n`, true);
}

export function debugDom(runId: string, stepIndex: number, dom: string): void {
  if (!keepDom) return;
  write(runId, `dom-${String(stepIndex).padStart(2, '0')}.html`, dom, false);
}

// Recording a run must never fail the run, and that goes double for a dev aid.
function write(runId: string, name: string, body: string, append: boolean): void {
  if (runsDir === null) return;
  try {
    const dir = path.join(runsDir, runId);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    if (append) appendFileSync(file, body);
    else writeFileSync(file, body);
  } catch (error) {
    console.error('run debug log failed', error);
  }
}
