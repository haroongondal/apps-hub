import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostCandidates } from '../index.ts';

test('a host gives itself, its parents and their google.* style wildcards, lowercased without the trailing dot', () => {
  const out = hostCandidates('A.b.Example.co.uk.');
  for (const want of ['a.b.example.co.uk', 'example.co.uk', 'example.*', 'example.co.*']) assert.ok(out.includes(want), want);
  assert.ok(!out.includes('*'), 'never the bare wildcard');
  assert.ok(out.every((h) => h === h.toLowerCase() && !h.endsWith('.')));
});

test('www. hosts match the bare domain and google.* filters', () => {
  const out = hostCandidates('www.google.com');
  assert.ok(out.includes('google.com'));
  assert.ok(out.includes('google.*'));
});

test('IP addresses, single-label and IPv6 hosts give only themselves', () => {
  assert.deepEqual(hostCandidates('192.168.1.10'), ['192.168.1.10']);
  assert.deepEqual(hostCandidates('localhost'), ['localhost']);
  assert.deepEqual(hostCandidates('[::1]'), ['[::1]']);
  assert.deepEqual(hostCandidates('[2001:db8::1]'), ['[2001:db8::1]']);
});

test('punycode hosts stay as Chrome gives them', () => {
  assert.ok(hostCandidates('xn--bcher-kva.example').includes('xn--bcher-kva.example'));
});

test('an empty host (chrome:// and file:// tabs) gives nothing', () => {
  assert.deepEqual(hostCandidates(''), []);
});
