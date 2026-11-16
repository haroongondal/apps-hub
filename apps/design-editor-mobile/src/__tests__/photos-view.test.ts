import assert from 'node:assert/strict';
import { test } from 'node:test';
import { photosView, scanDecision, scanLine, toolResultText, waitingText } from '../photos/view.ts';

const base = { access: 'all' as const, modelsReady: true, gettingTool: false, indexed: 10, scanning: false };

test('photosView picks the screen from access, search tool and scan state', () => {
  assert.equal(photosView({ ...base, access: 'none' }), 'ask');
  assert.equal(photosView({ ...base, access: 'blocked' }), 'blocked');
  assert.equal(photosView({ ...base, modelsReady: false }), 'get-tool');
  assert.equal(photosView({ ...base, modelsReady: false, gettingTool: true }), 'getting-tool');
  assert.equal(photosView({ ...base, indexed: 0, scanning: true }), 'preparing');
  assert.equal(photosView({ ...base, indexed: 0, scanning: false }), 'search');
  assert.equal(photosView({ ...base, access: 'some', scanning: true }), 'search');
});

test('the words for each outcome are the plain ones', () => {
  assert.equal(toolResultText('ready'), null);
  assert.equal(toolResultText('no-room'), 'Not enough space. Free up about 300 MB and try again.');
  assert.equal(toolResultText('bad-download'), "The search tool didn't download correctly. Try again.");
  assert.equal(toolResultText('offline'), 'The download stopped. Check your connection and try again.');
  assert.equal(waitingText(null), null);
  assert.equal(waitingText('heat'), 'Paused while your phone cools down. It carries on by itself.');
  assert.equal(waitingText('battery'), 'Paused to save battery. It carries on when you charge or the battery is above 20%.');
  assert.equal(scanLine(1204, null), '1,204 photos ready to search');
  assert.equal(scanLine(0, 0.37), 'Getting your photos ready · 37%');
});

const scan = { before: 'all' as const, access: 'all' as const, force: false, modelsReady: true, galleryChanged: false, active: true };

test('scanDecision scans on a changed gallery, more access or a forced scan', () => {
  assert.equal(scanDecision({ ...scan, before: null }), 'none');
  assert.equal(scanDecision(scan), 'none');
  assert.equal(scanDecision({ ...scan, galleryChanged: true }), 'scan');
  assert.equal(scanDecision({ ...scan, before: 'none', access: 'all' }), 'scan');
  assert.equal(scanDecision({ ...scan, before: 'none', access: 'some' }), 'scan');
  assert.equal(scanDecision({ ...scan, before: 'some', access: 'all' }), 'scan');
  assert.equal(scanDecision({ ...scan, force: true }), 'scan');
});

test('scanDecision waits for the app to come back, and never scans without access or the search tool', () => {
  assert.equal(scanDecision({ ...scan, galleryChanged: true, active: false }), 'pending');
  assert.equal(scanDecision({ ...scan, force: true, active: false }), 'pending');
  assert.equal(scanDecision({ ...scan, active: false }), 'none');
  assert.equal(scanDecision({ ...scan, access: 'none', force: true }), 'none');
  assert.equal(scanDecision({ ...scan, access: 'blocked', force: true }), 'none');
  assert.equal(scanDecision({ ...scan, modelsReady: false, force: true }), 'none');
});
