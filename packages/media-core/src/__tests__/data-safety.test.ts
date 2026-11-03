// PRD §5 data-safety rules that media-core can prove. Rules 4 and 5 are native (Kotlin tests),
// and rule 2's write paths are enforced by the Mac main process and the Android module.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { planSize } from '../budget.ts';
import { outputName } from '../names.ts';
import type { MediaInfo } from '../types.ts';

const clip = (durationS: number): MediaInfo => ({
  id: 'in', name: 'Trip.mp4', bytes: 2_000_000_000, durationS, container: 'mp4',
  tracks: [
    { index: 0, kind: 'video', codec: 'h264', width: 1920, height: 1080, fps: 30 },
    { index: 1, kind: 'audio', codec: 'aac', bitrate: 256000 },
  ],
});

test('rule 1: an output name is never the input name', () => {
  assert.notEqual(outputName('Trip.mp4', 'compressed', 'mp4', () => false), 'Trip.mp4');
  assert.notEqual(outputName('Trip', 'compressed', 'mp4', () => false), 'Trip');
});

test('rule 2: output names carry no path separators, so they stay in the chosen folder', () => {
  assert.doesNotMatch(outputName('../../etc/passwd', 'compressed', 'mp4', () => false), /[\\/]/);
  assert.doesNotMatch(outputName('a\\b:c.mov', 'compressed', 'mp4', () => false), /[\\/]/);
});

test('rule 3: a planned output never exceeds the target', () => {
  for (const durationS of [5, 20, 60, 90, 180, 600]) {
    for (const target of [1_000_000, 16_000_000, 20_000_000, 50_000_000]) {
      for (const encoder of ['hw-h264', 'hw-hevc', 'x264'] as const) {
        const got = planSize(clip(durationS), target, encoder);
        if (got.ok) {
          assert.ok(got.plan.plannedBytes <= target, `${durationS}s ${target} ${encoder}: ${got.plan.plannedBytes}`);
        }
      }
    }
  }
});

test('rule 6: media-core has no network code', () => {
  const dir = new URL('../', import.meta.url);
  const network = /\b(fetch|XMLHttpRequest|WebSocket|node:http|node:https|node:net|node:dgram|node:tls)\b/;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.ts')) continue;
    assert.doesNotMatch(fs.readFileSync(new URL(file, dir), 'utf8'), network, file);
  }
});
