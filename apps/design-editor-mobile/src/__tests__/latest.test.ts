import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLatest } from '../timeline/latest.ts';

const after = <T,>(ms: number, value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms));

test('latest: a slow older answer is dropped when a newer request has started', async () => {
  const latest = createLatest<string>();
  const older = latest(after(20, 'old'));
  const newer = latest(Promise.resolve('new'));
  assert.equal(await newer, 'new');
  assert.equal(await older, undefined);
});

test('latest: an older request that fails is dropped, the newest one that fails still fails', async () => {
  const latest = createLatest<string>();
  const older = latest(Promise.reject(new Error('older')));
  const newer = latest(after(5, 'fine'));
  assert.equal(await older, undefined);
  assert.equal(await newer, 'fine');
  await assert.rejects(latest(Promise.reject(new Error('newest'))), /newest/);
});
