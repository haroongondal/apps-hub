/** Firewall contract: the adapter runs against a stand-in; Kotlin and Swift are checked as source text, as Node cannot run them. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OPEN_TUNNEL_ERROR_CODES,
  OpenTunnelError,
  bindFirewall,
  createFirewallBinding,
  ruleFromWire,
  ruleToWire,
  verdictFromWire,
  type FirewallApi,
  type FirewallNativeApi,
  type FirewallRuleKind,
  type NativeAppRule,
  type NativeLogRow,
} from '../index.ts';

const NATIVE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KOTLIN_ROOT = join(NATIVE_ROOT, 'android/src/main/java/expo/modules/opentunnelnative');
const kotlinModule = readFileSync(join(KOTLIN_ROOT, 'OpenTunnelNativeModule.kt'), 'utf8');
const kotlinDecision = readFileSync(join(KOTLIN_ROOT, 'firewall/FirewallDecision.kt'), 'utf8');
const swiftModule = readFileSync(join(NATIVE_ROOT, 'ios/OpenTunnelNativeModule.swift'), 'utf8');

const FIREWALL_FUNCTIONS = [
  'getFirewallStatus',
  'setFirewallEnabled',
  'setPaused',
  'getAppRules',
  'setAppRule',
  'getActivityLog',
  'clearActivityLog',
  'getDataUse',
  'openUsageAccessSettings',
] as const;

function enumNames(source: string, enumName: string): string[] {
  const match = new RegExp(`enum class ${enumName}\\s*\\{([^}]*)\\}`).exec(source);
  assert.ok(match, `${enumName} enum not found in the Kotlin source`);
  return match[1].split(',').map((name) => name.trim()).filter((name) => name.length > 0);
}

function swiftFunctionBody(name: string): string {
  const start = swiftModule.indexOf(`AsyncFunction("${name}")`);
  assert.notEqual(start, -1, `Swift is missing AsyncFunction("${name}")`);
  const next = swiftModule.indexOf('AsyncFunction("', start + 1);
  return swiftModule.slice(start, next === -1 ? undefined : next);
}

interface StandIn {
  api: FirewallNativeApi;
  calls: Array<{ name: string; args: unknown[] }>;
}

function standInNative(overrides: (calls: StandIn['calls']) => Partial<FirewallNativeApi> = () => ({})): StandIn {
  const calls: StandIn['calls'] = [];
  const record =
    <T>(name: string, result: T) =>
    async (...args: unknown[]): Promise<T> => {
      calls.push({ name, args });
      return result;
    };
  const api: FirewallNativeApi = {
    getFirewallStatus: record('getFirewallStatus', {
      enabled: true,
      running: false,
      paused: true,
      usageAccess: false,
      privateDns: { mode: 'automatic', provider: null },
    }),
    setFirewallEnabled: record('setFirewallEnabled', null),
    setPaused: record('setPaused', null),
    getAppRules: record('getAppRules', [] as NativeAppRule[]),
    setAppRule: record('setAppRule', null),
    getActivityLog: record('getActivityLog', [] as NativeLogRow[]),
    clearActivityLog: record('clearActivityLog', null),
    getDataUse: record('getDataUse', []),
    openUsageAccessSettings: record('openUsageAccessSettings', null),
    ...overrides(calls),
  };
  return { api, calls };
}

function logRow(overrides: Partial<NativeLogRow> = {}): NativeLogRow {
  return {
    timestampMs: 1_700_000_000_000,
    uid: 10_123,
    pkg: 'org.example.app',
    proto: 'tcp',
    dst: '203.0.113.9',
    dstPort: 443,
    domain: 'example.org',
    bytesOut: 120,
    bytesIn: 4096,
    verdict: 'ALLOW',
    ...overrides,
  };
}

test('FIREWALL_NOT_SUPPORTED is a typed error code shared with the native modules', () => {
  assert.equal(OPEN_TUNNEL_ERROR_CODES.FIREWALL_NOT_SUPPORTED, 'ERR_FIREWALL_NOT_SUPPORTED');
  assert.match(kotlinModule, /ERR_FIREWALL_NOT_SUPPORTED = "ERR_FIREWALL_NOT_SUPPORTED"/);
  assert.match(swiftModule, /firewallNotSupported = "ERR_FIREWALL_NOT_SUPPORTED"/);
});

test("the adapter sends 'block_on_mobile' as FirewallRule.BLOCK_ON_MOBILE", () => {
  assert.equal(ruleToWire('block_on_mobile'), 'BLOCK_ON_MOBILE');
  assert.equal(ruleToWire('allow'), 'ALLOW');
  assert.equal(ruleToWire('block_always'), 'BLOCK_ALWAYS');
});

test('every Kotlin FirewallRule has a TS kind and the wire strings round-trip', () => {
  const kinds: FirewallRuleKind[] = ['allow', 'block_on_mobile', 'block_always'];
  const wire = kinds.map(ruleToWire).sort();
  assert.deepEqual(wire, enumNames(kotlinDecision, 'FirewallRule').sort());
  for (const kind of kinds) assert.equal(ruleFromWire(ruleToWire(kind)), kind);
});

test('an unknown rule kind or wire string is a typed error, not a guess', () => {
  assert.throws(() => ruleToWire('block_never' as FirewallRuleKind), {
    code: OPEN_TUNNEL_ERROR_CODES.INVALID_PARAMS,
  });
  assert.throws(() => ruleFromWire('BLOCK_NEVER'), { code: OPEN_TUNNEL_ERROR_CODES.FIREWALL_FAILED });
});

test('a prototype property name is an unknown rule or verdict, never a lookup hit', () => {
  for (const name of ['constructor', 'toString', '__proto__']) {
    assert.throws(() => ruleToWire(name as FirewallRuleKind), { code: OPEN_TUNNEL_ERROR_CODES.INVALID_PARAMS }, name);
    assert.throws(() => ruleFromWire(name), { code: OPEN_TUNNEL_ERROR_CODES.FIREWALL_FAILED }, name);
    assert.throws(() => verdictFromWire(name), { code: OPEN_TUNNEL_ERROR_CODES.FIREWALL_FAILED }, name);
  }
});

test("Kotlin Verdict.ALLOW and Verdict.BLOCK map to 'allowed' and 'blocked'", () => {
  assert.deepEqual(enumNames(kotlinDecision, 'Verdict').sort(), ['ALLOW', 'BLOCK']);
  assert.equal(verdictFromWire('ALLOW'), 'allowed');
  assert.equal(verdictFromWire('BLOCK'), 'blocked');
  assert.throws(() => verdictFromWire('DROP'), { code: OPEN_TUNNEL_ERROR_CODES.FIREWALL_FAILED });
});

test('setAppRule hands the native module the wire string and rejects a bad uid', async () => {
  const { api, calls } = standInNative();
  const firewall = bindFirewall(api);
  await firewall.setAppRule(10_123, 'block_on_mobile');
  assert.deepEqual(calls, [{ name: 'setAppRule', args: [10_123, 'BLOCK_ON_MOBILE'] }]);
  await assert.rejects(firewall.setAppRule(-1, 'allow'), { code: OPEN_TUNNEL_ERROR_CODES.INVALID_PARAMS });
  await assert.rejects(firewall.setAppRule(1.5, 'allow'), { code: OPEN_TUNNEL_ERROR_CODES.INVALID_PARAMS });
  assert.equal(calls.length, 1);
});

test('getActivityLog passes a limit (default 1000) and maps verdict and unknown apps', async () => {
  const rows = [
    logRow({ verdict: 'BLOCK' }),
    logRow({ uid: -1, pkg: 'unknown', domain: null, verdict: 'ALLOW' }),
    logRow({ uid: -1, pkg: 'Unknown app', verdict: 'ALLOW' }),
  ];
  const { api, calls } = standInNative((recorded) => ({
    getActivityLog: async (...args: unknown[]) => {
      recorded.push({ name: 'getActivityLog', args });
      return rows;
    },
  }));
  const firewall = bindFirewall(api);

  const entries = await firewall.getActivityLog({ blockedOnly: false });
  assert.deepEqual(calls[0], { name: 'getActivityLog', args: [null, false, 1000] });
  assert.deepEqual(
    entries.map((entry) => [entry.verdict, entry.pkg, entry.domain]),
    [
      ['blocked', 'org.example.app', 'example.org'],
      ['allowed', 'Unknown app', null],
      ['allowed', 'Unknown app', 'example.org'],
    ],
  );

  await firewall.getActivityLog({ uid: 10_123, blockedOnly: true, limit: 50 });
  assert.deepEqual(calls[1], { name: 'getActivityLog', args: [10_123, true, 50] });
  await assert.rejects(firewall.getActivityLog({ blockedOnly: false, limit: 0 }), {
    code: OPEN_TUNNEL_ERROR_CODES.INVALID_PARAMS,
  });
});

test('getFirewallStatus exposes paused and getAppRules maps the wire rule to a kind', async () => {
  const { api } = standInNative(() => ({
    getAppRules: async () => [
      { uid: 10_001, pkg: 'org.example.a', label: 'Example A', rule: 'BLOCK_ALWAYS' },
      { uid: 10_002, pkg: 'org.example.b', label: 'Example B', rule: 'ALLOW' },
    ],
  }));
  const firewall = bindFirewall(api);
  assert.deepEqual(await firewall.getFirewallStatus(), {
    enabled: true,
    running: false,
    paused: true,
    usageAccess: false,
    privateDns: { mode: 'automatic', provider: null },
  });
  assert.deepEqual(
    (await firewall.getAppRules()).map((app) => [app.uid, app.rule]),
    [
      [10_001, 'block_always'],
      [10_002, 'allow'],
    ],
  );
});

test('getDataUse passes the start time through and rejects a bad one before the bridge', async () => {
  const { api, calls } = standInNative();
  const firewall = bindFirewall(api);
  await firewall.getDataUse(1_700_000_000_000);
  assert.deepEqual(calls.at(-1), { name: 'getDataUse', args: [1_700_000_000_000] });
  for (const sinceMs of [-1, Number.NaN]) {
    await assert.rejects(firewall.getDataUse(sinceMs), (error: unknown) => {
      assert.ok(error instanceof OpenTunnelError);
      assert.equal(error.code, OPEN_TUNNEL_ERROR_CODES.INVALID_PARAMS);
      return true;
    });
  }
  assert.equal(calls.filter((call) => call.name === 'getDataUse').length, 1);
});

test('a runtime without the firewall rejects every function with FIREWALL_NOT_SUPPORTED', async () => {
  for (const platform of ['ios', 'unavailable'] as const) {
    const firewall: FirewallApi = createFirewallBinding({ platform });
    const attempts: Record<(typeof FIREWALL_FUNCTIONS)[number], () => Promise<unknown>> = {
      getFirewallStatus: () => firewall.getFirewallStatus(),
      setFirewallEnabled: () => firewall.setFirewallEnabled(true),
      setPaused: () => firewall.setPaused(true),
      getAppRules: () => firewall.getAppRules(),
      setAppRule: () => firewall.setAppRule(10_123, 'allow'),
      getActivityLog: () => firewall.getActivityLog({ blockedOnly: false }),
      clearActivityLog: () => firewall.clearActivityLog(),
      getDataUse: () => firewall.getDataUse(0),
      openUsageAccessSettings: () => firewall.openUsageAccessSettings(),
    };
    for (const name of FIREWALL_FUNCTIONS) {
      await assert.rejects(attempts[name](), (error: unknown) => {
        assert.ok(error instanceof OpenTunnelError, `${platform} ${name} must throw OpenTunnelError`);
        assert.equal(error.code, OPEN_TUNNEL_ERROR_CODES.FIREWALL_NOT_SUPPORTED, `${platform} ${name}`);
        return true;
      });
    }
  }
});

test('the iOS module rejects every firewall function with the typed code and never resolves', () => {
  for (const name of FIREWALL_FUNCTIONS) {
    const body = swiftFunctionBody(name);
    assert.match(body, /promise\.reject\(ErrorCode\.firewallNotSupported,/, `${name} must reject typed`);
    assert.doesNotMatch(body, /promise\.resolve/, `${name} must not resolve a fake value`);
  }
});

test('the Android module declares every firewall function and gates them on API 29', () => {
  for (const name of FIREWALL_FUNCTIONS) {
    assert.match(kotlinModule, new RegExp(`AsyncFunction\\("${name}"\\)`), `Kotlin is missing ${name}`);
  }
  assert.match(kotlinModule, /FirewallContract\.isSupported\(Build\.VERSION\.SDK_INT\)/);
});
