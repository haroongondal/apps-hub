import assert from 'node:assert/strict';
import test from 'node:test';
import { LEGACY_AUTHORITIES, LINK_PERMISSION, actionName, isKnownAuthority, isShareAuthority, shareAuthority } from '../index.ts';

test('permission keeps the Autopilot name', () => {
  assert.equal(LINK_PERMISSION, 'com.haroon.permission.AUTOPILOT');
});

test('share authority is com.haroon.<app>.applink', () => {
  assert.equal(shareAuthority('inflow'), 'com.haroon.inflow.applink');
  assert.equal(shareAuthority('designeditor'), 'com.haroon.designeditor.applink');
  assert.ok(isShareAuthority('com.haroon.deputy.applink'));
  for (const bad of ['Inflow', 'in-flow', 'in.flow', '1inflow', '', 'in_flow', 'inflow\n', ' inflow']) {
    assert.throws(() => shareAuthority(bad), bad);
  }
});

test('rejects wrong shapes and injection-like strings', () => {
  const bad = [
    'com.haroon.Inflow.applink', 'com.other.x.applink', '', 'com.haroon..applink', 'com.haroon.inflow.applink.',
    'com.haroon.inflow.applink\n', 'com.haroon.inflow.applink/../x', 'com.haroon.a.b.applink', "com.haroon.x.applink'; --",
    'com.haroon.inflow.autopilot', 'content://com.haroon.inflow.applink',
  ];
  for (const s of bad) assert.equal(isShareAuthority(s), false, JSON.stringify(s));
  for (const v of [undefined, null, 5, {}]) assert.equal(isKnownAuthority(v), false);
});

test('the legacy Autopilot authority is known but not a share-shaped name', () => {
  assert.deepEqual(LEGACY_AUTHORITIES, ['com.haroon.inflow.autopilot']);
  assert.ok(isKnownAuthority('com.haroon.inflow.autopilot'));
  assert.equal(isShareAuthority('com.haroon.inflow.autopilot'), false);
  assert.ok(isKnownAuthority('com.haroon.inflow.applink'));
  assert.equal(isKnownAuthority('com.haroon.deputy.autopilot'), false);
});

test('action names are com.haroon.<app>.action.<NAME>', () => {
  assert.equal(actionName('deputy', 'RUN_TASK'), 'com.haroon.deputy.action.RUN_TASK');
  for (const bad of ['run', 'Run', '_X', '1X', '', 'A-B', 'A.B', 'A\n']) assert.throws(() => actionName('deputy', bad), bad);
  assert.throws(() => actionName('Deputy', 'X'));
});
