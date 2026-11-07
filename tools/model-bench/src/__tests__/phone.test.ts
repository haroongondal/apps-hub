import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const phoneSh = fileURLToPath(new URL('../../phone.sh', import.meta.url));

// A fake adb that logs every call and reports one device, so phone.sh runs without a phone.
function fakeAdb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'phone-sh-'));
  const log = path.join(dir, 'calls.log');
  const adb = path.join(dir, 'adb');
  writeFileSync(adb, `#!/usr/bin/env bash\necho "$*" >>"${log}"\n[ "$1" = devices ] && printf 'List of devices attached\\nSER\\tdevice\\n'\nexit 0\n`);
  chmodSync(adb, 0o755);
  return { adb, log };
}

test('clean stops every saved llama-server before deleting the folder', () => {
  const { adb, log } = fakeAdb();
  const r = spawnSync('bash', [phoneSh, 'clean'], { env: { ...process.env, ADB: adb, ANDROID_SERIAL: 'SER' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const shell = readFileSync(log, 'utf8').split('\n').filter((l) => l.startsWith('shell ')).join('\n');
  assert.match(shell, /kill[\s\S]*rm -rf \/data\/local\/tmp\/mb/);
});
