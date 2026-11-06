import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DESTINATIONS, QUALITY_PRESETS } from '../presets.ts';

test('presets: destination limits are decimal megabytes (PRD FR-3, RESEARCH §6.1)', () => {
  const bytes = Object.fromEntries(DESTINATIONS.map(d => [d.id, d.bytes]));
  assert.deepEqual(bytes, {
    discord: 20_000_000,
    'discord-nitro-basic': 50_000_000,
    email: 18_000_000,
    whatsapp: 16_000_000,
  });
});

test('presets: quality caps match PRD FR-4', () => {
  assert.equal(QUALITY_PRESETS.medium.maxShortSide, 1080);
  assert.equal(QUALITY_PRESETS.small.maxShortSide, 720);
  assert.equal(QUALITY_PRESETS.small.maxFps, 30);
});
