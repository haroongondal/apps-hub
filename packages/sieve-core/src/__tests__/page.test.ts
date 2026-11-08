import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { emptyCosmetic, pageInjections, scriptletArgs, scriptletFunction, scriptletKey, storedCosmetic, type CosmeticSet } from '../index.ts';

const set = (parts: Partial<CosmeticSet>): CosmeticSet => ({ ...emptyCosmetic(), ...parts });
const never = () => false;
const always = () => true;
const aopr = { name: 'abort-on-property-read', args: ['adsbygoogle'] };
const setConstant = { name: 'set-constant', args: ['foo', '1'] };

test('a site-specific hide rule applies to the host and its subdomains, one rule per selector', () => {
  const sets = [set({ hide: { 'example.com': ['.a', '#b'] } })];
  assert.equal(pageInjections('shop.example.com', [set({ hide: { 'example.com': ['.a'] } })], never).css, '.a{display:none!important}');
  assert.equal(pageInjections('example.com', sets, never).css, '.a{display:none!important}\n#b{display:none!important}');
  assert.deepEqual(pageInjections('example.org', sets, never), { css: '', scriptlets: [] });
});

test('an unhide rule for the host removes the selector', () => {
  const sets = [set({ hide: { 'example.com': ['.a'] }, unhide: { 'shop.example.com': ['.a'] } })];
  assert.equal(pageInjections('shop.example.com', sets, never).css, '');
  assert.equal(pageInjections('www.example.com', sets, never).css, '.a{display:none!important}');
});

test('when the generic CSS is excluded on the host, the page gets it minus the unhidden selectors', () => {
  const sets = [set({ generic: ['.g1', '.g2'], unhide: { 'x.com': ['.g1'] } })];
  assert.equal(pageInjections('x.com', sets, always).css, '.g2{display:none!important}');
  assert.equal(pageInjections('x.com', sets, never).css, '', 'the registered stylesheet covers it when not excluded');
});

test('excluded is asked per set, by index', () => {
  const sets = [set({ generic: ['.g1'] }), set({ generic: ['.g2'] })];
  assert.equal(pageInjections('x.com', sets, (i) => i === 1).css, '.g2{display:none!important}');
});

test('a generichide host gets no generic rules but keeps its site-specific ones', () => {
  const sets = [set({ generic: ['.g1'], hide: { 'x.com': ['.s'] }, generichide: ['x.com'] })];
  assert.equal(pageInjections('www.x.com', sets, always).css, '.s{display:none!important}');
});

test('an elemhide host gets nothing from that set, and other sets still apply', () => {
  const sets = [
    set({ generic: ['.g1'], hide: { 'x.com': ['.s'] }, scriptlets: { 'x.com': [aopr] }, elemhide: ['x.com'] }),
    set({ hide: { 'x.com': ['.other'] } }),
  ];
  assert.deepEqual(pageInjections('x.com', sets, always), { css: '.other{display:none!important}', scriptlets: [] });
});

test('scriptlets apply on every site and per host, without duplicates', () => {
  const sets = [set({ scriptlets: { '*': [aopr], 'example.com': [setConstant, aopr] } })];
  assert.deepEqual(pageInjections('www.example.com', sets, never).scriptlets, [setConstant, aopr]);
  assert.deepEqual(pageInjections('example.org', sets, never).scriptlets, [aopr]);
});

test('scriptletExcept removes one scriptlet, or all of them with *', () => {
  const sets = [set({ scriptlets: { '*': [aopr], 'example.com': [setConstant] } })];
  const one = [...sets, set({ scriptletExcept: { 'example.com': [scriptletKey(aopr)] } })];
  assert.deepEqual(pageInjections('example.com', one, never).scriptlets, [setConstant]);
  const all = [set({ ...sets[0], scriptletExcept: { 'example.com': ['*'] } })];
  assert.deepEqual(pageInjections('example.com', all, never).scriptlets, []);
  assert.deepEqual(pageInjections('example.org', all, never).scriptlets, [aopr]);
});

test("'*' keys reach every site: hide, unhide and scriptletExcept", () => {
  const sets = [set({ hide: { '*': ['.h'], 'x.com': ['.u'] }, unhide: { '*': ['.u'] }, scriptlets: { 'x.com': [aopr] }, scriptletExcept: { '*': [scriptletKey(aopr)] } })];
  assert.deepEqual(pageInjections('x.com', sets, never), { css: '.h{display:none!important}', scriptlets: [] });
});

test('google.* hide rules apply to www.google.de', () => {
  const sets = [set({ hide: { 'google.*': ['#tads'] } })];
  assert.equal(pageInjections('www.google.de', sets, never).css, '#tads{display:none!important}');
});

test('scriptletArgs gives the scriptlet function what it takes: set-constant foo 1 sets window.foo to 1', () => {
  const ctx = vm.createContext({ console });
  vm.runInContext('var window = globalThis; globalThis.Window = function Window() {};', ctx);
  // Like executeScript: the function travels as source text and the args are structured-cloned.
  const fn = vm.runInContext(`(${scriptletFunction(setConstant.name)?.toString()})`, ctx);
  fn(...structuredClone(scriptletArgs(setConstant)));
  assert.equal(vm.runInContext('window.foo', ctx), 1);
});

test('hosts named like Object members do not pick up prototype properties', () => {
  const sets = [set({ hide: { 'x.com': ['.a'] } })];
  for (const host of ['constructor', '__proto__']) assert.deepEqual(pageInjections(host, sets, never), { css: '', scriptlets: [] }, host);
});

test('storedCosmetic reads what storage holds: an empty set when absent, damaged fields replaced by empty ones', () => {
  assert.deepEqual(storedCosmetic(undefined), emptyCosmetic());
  assert.deepEqual(storedCosmetic([]), emptyCosmetic());
  assert.deepEqual(storedCosmetic({ hide: { 'a.com': ['.x'] } }), set({ hide: { 'a.com': ['.x'] } }));
  const damaged = storedCosmetic({ hide: null, unhide: 'x', generic: {}, elemhide: ['a.com'] });
  assert.deepEqual(damaged, set({ elemhide: ['a.com'] }));
  assert.equal(pageInjections('a.com', [storedCosmetic({ hide: null })], never).css, '');
});
