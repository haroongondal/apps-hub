import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EmailRecoveryStatus, LostAccessState } from 'strongroom-vault';
import { EMAIL_DISCLOSURE, NEW_KEY_ESCROW_WARNING, emailProblem, emailRecoveryView, explainRecovery, lostAccessView, pendingBanner } from '../recovery-flow.ts';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

const status = (o: Partial<EmailRecoveryStatus> = {}): EmailRecoveryStatus => ({
  available: true,
  checked: true,
  enrolled: false,
  waitingForCode: false,
  pendingRecovery: null,
  wasTurnedOff: false,
  keyUnseen: false,
  ...o,
});
const coded = (code: string, message = 'native message') => Object.assign(new Error(message), { code });

test('emailProblem accepts a padded address and rejects blank, too long and no at sign', () => {
  assert.equal(emailProblem(' A@B.co '), null);
  assert.ok(emailProblem('   '));
  assert.ok(emailProblem(`${'a'.repeat(316)}@b.co`));
  assert.equal(emailProblem(`${'a'.repeat(315)}@b.co`), null);
  assert.ok(emailProblem('ab.co'));
  assert.ok(emailProblem('a b@c.co'));
});

test('emailProblem refuses what the Worker refuses: no dot in the domain, or an empty part around it', () => {
  for (const bad of ['a@b', 'a@localhost', 'a@b.', 'a@.b']) assert.ok(emailProblem(bad), bad);
});

test('emailProblem counts the trimmed address against 320 characters', () => {
  const edge = `${'a'.repeat(315)}@b.co`;
  assert.equal(edge.length, 320);
  assert.equal(emailProblem(` ${edge} `), null);
  assert.ok(emailProblem(`${edge}c`));
});

test('pendingBanner only shows a confirmed request', () => {
  assert.equal(pendingBanner(null, NOW), null);
  assert.equal(pendingBanner(status(), NOW), null);
  assert.equal(pendingBanner(status({ pendingRecovery: { releaseAt: null } }), NOW), null);
  const b = pendingBanner(status({ pendingRecovery: { releaseAt: NOW + 5 * HOUR } }), NOW);
  assert.ok(b);
  assert.match(b.body, /about 5 hours/);
});

test('pendingBanner is null when the status could not be checked', () => {
  assert.equal(pendingBanner(status({ checked: false, pendingRecovery: { releaseAt: NOW + HOUR } }), NOW), null);
});

test('time left rounds down and says less than an hour under one', () => {
  const body = (ms: number) => pendingBanner(status({ pendingRecovery: { releaseAt: NOW + ms } }), NOW)?.body ?? '';
  assert.match(body(59 * 60_000), /less than an hour/);
  assert.match(body(HOUR), /about 1 hour,/);
  assert.match(body(HOUR + 1), /about 1 hour,/);
  assert.match(body(2 * HOUR - 1), /about 1 hour,/);
  assert.match(body(2 * HOUR), /about 2 hours,/);
});

test('pendingBanner reads differently once the wait is over', () => {
  const soon = pendingBanner(status({ pendingRecovery: { releaseAt: NOW + HOUR } }), NOW);
  const over = pendingBanner(status({ pendingRecovery: { releaseAt: NOW - 1 } }), NOW);
  assert.ok(soon && over);
  assert.notEqual(soon.body, over.body);
  assert.match(over.body, /over/);
});

test('lostAccessView tells an unconfirmed claim from a confirmed one', () => {
  const link = lostAccessView({ state: 'waiting', releaseAt: null }, NOW);
  const timed = lostAccessView({ state: 'waiting', releaseAt: NOW + 3 * HOUR }, NOW, () => 'CLOCK');
  assert.match(link.body, /link we emailed/);
  assert.match(link.body, /address you set up for email recovery/);
  assert.match(link.body, /Only open the link if you asked for it from this phone just now/);
  assert.match(link.body, /If no email arrives within a few minutes, email recovery may not be turned on for this account; use your recovery key instead/);
  assert.doesNotMatch(timed.body, /link we emailed/);
  assert.match(timed.body, /about 3 hours/);
  assert.match(timed.body, /CLOCK/);
  // An unconfirmed claim can ask for the email again; a confirmed one is counting down and offers nothing.
  assert.deepEqual(link.actions, ['request']);
  assert.deepEqual(timed.actions, []);
});

test('lostAccessView offers a request when none exists and the code field when ready', () => {
  assert.deepEqual(lostAccessView({ state: 'none' }, NOW).actions, ['request']);
  assert.deepEqual(lostAccessView({ state: 'ready' }, NOW).actions, ['enterCode']);
});

test('emailRecoveryView offers turnOn only when available, checked and not enrolled or waiting', () => {
  assert.deepEqual(emailRecoveryView(status()).actions, ['turnOn']);
  assert.deepEqual(emailRecoveryView(status({ wasTurnedOff: true })).actions, ['turnOn']);
  assert.deepEqual(emailRecoveryView(status({ available: false })).actions, []);
  assert.deepEqual(emailRecoveryView(status({ checked: false })).actions, []);
  assert.ok(!emailRecoveryView(status({ enrolled: true })).actions.includes('turnOn'));
  assert.ok(!emailRecoveryView(status({ waitingForCode: true })).actions.includes('turnOn'));
});

test('emailRecoveryView offers enterCode while waiting for the code, and an escape', () => {
  const v = emailRecoveryView(status({ waitingForCode: true }));
  assert.ok(v.actions.includes('enterCode'));
  assert.ok(v.actions.includes('turnOff'));
});

test('emailRecoveryView offers turnOff when on and cancel when a request is pending', () => {
  assert.deepEqual(emailRecoveryView(status({ enrolled: true })).actions, ['turnOff']);
  const pending = emailRecoveryView(status({ enrolled: true, pendingRecovery: { releaseAt: NOW + HOUR } }));
  assert.ok(pending.actions.includes('cancel'));
  const unconfirmed = emailRecoveryView(status({ enrolled: true, pendingRecovery: { releaseAt: null } }));
  assert.ok(unconfirmed.actions.includes('cancel'));
});

test('emailRecoveryView says when it could not check, and when the server turned it off', () => {
  const unchecked = emailRecoveryView(status({ checked: false }));
  assert.match(unchecked.subtitle, /couldn't check/i);
  assert.equal(unchecked.tone, 'warn');
  const off = emailRecoveryView(status({ wasTurnedOff: true }));
  assert.match(off.subtitle, /turned off/);
  assert.notEqual(off.subtitle, emailRecoveryView(status()).subtitle);
  assert.equal(emailRecoveryView(status({ enrolled: true })).tone, 'ok');
  assert.equal(emailRecoveryView(status({ enrolled: true, pendingRecovery: { releaseAt: null } })).tone, 'warn');
  assert.equal(emailRecoveryView(status({ enrolled: true, pendingRecovery: { releaseAt: NOW + HOUR } })).tone, 'danger');
});

test('emailRecoveryView warns about an unseen recovery key and offers a new one, even when unchecked', () => {
  for (const o of [{}, { checked: false }, { enrolled: true }, { waitingForCode: true }, { checked: false, enrolled: true }]) {
    const v = emailRecoveryView(status({ keyUnseen: true, ...o }));
    assert.equal(v.tone, 'danger', JSON.stringify(o));
    assert.match(v.title, /recovery key changed/i);
    assert.match(v.subtitle, /new one/i);
    assert.ok(v.actions.includes('newKey'), JSON.stringify(o));
  }
  assert.ok(!emailRecoveryView(status()).actions.includes('newKey'));
  assert.ok(!emailRecoveryView(status({ checked: false })).actions.includes('newKey'));
});

test('an unseen key keeps the other actions of the state it is in', () => {
  assert.deepEqual(emailRecoveryView(status({ keyUnseen: true, waitingForCode: true })).actions, ['newKey', 'enterCode', 'turnOff']);
  assert.deepEqual(emailRecoveryView(status({ keyUnseen: true, enrolled: true })).actions, ['newKey', 'turnOff']);
  assert.deepEqual(emailRecoveryView(status({ keyUnseen: true, checked: false })).actions, ['newKey']);
});

test('emailRecoveryView is the same when the status is unchecked whatever the other flags say', () => {
  const v = emailRecoveryView(status({ checked: false, enrolled: true, waitingForCode: true }));
  assert.deepEqual(v.actions, []);
});

test('explainRecovery maps every email recovery code to its own message', () => {
  const codes = ['BAD_EMAIL', 'SYNC_OFF', 'SYNC_FIRST', 'LOST_STILL_ALIVE', 'LOST_NOT_READY', 'LOST_DIFFERENT_ACCOUNT'];
  const messages = codes.map((c) => explainRecovery(coded(c)));
  for (const m of messages) assert.notEqual(m, 'native message');
  assert.equal(new Set(messages).size, codes.length);
});

test('explainRecovery falls back to the native message, then to the generic one', () => {
  assert.equal(explainRecovery(coded('SYNC_OFFLINE', 'No connection. Try again.')), 'No connection. Try again.');
  assert.match(explainRecovery(coded('ERR_SOMETHING')), /Something went wrong/);
  assert.match(explainRecovery(undefined), /Something went wrong/);
});

test('copy has no emoji and no ALL-CAPS words longer than three letters', () => {
  const all: string[] = [...EMAIL_DISCLOSURE, NEW_KEY_ESCROW_WARNING];
  const statuses: EmailRecoveryStatus[] = [];
  for (const available of [true, false])
    for (const checked of [true, false])
      for (const enrolled of [true, false])
        for (const waitingForCode of [true, false])
          for (const wasTurnedOff of [true, false])
            for (const keyUnseen of [true, false])
              for (const pendingRecovery of [null, { releaseAt: null }, { releaseAt: NOW + 30 * 60_000 }, { releaseAt: NOW + HOUR }, { releaseAt: NOW + 20 * HOUR }, { releaseAt: NOW - 1 }])
                statuses.push(status({ available, checked, enrolled, waitingForCode, wasTurnedOff, keyUnseen, pendingRecovery }));
  for (const s of statuses) {
    const v = emailRecoveryView(s);
    all.push(v.title, v.subtitle);
    const b = pendingBanner(s, NOW);
    if (b) all.push(b.title, b.body);
  }
  const lost: LostAccessState[] = [{ state: 'none' }, { state: 'ready' }, { state: 'waiting', releaseAt: null }, { state: 'waiting', releaseAt: NOW + HOUR }, { state: 'waiting', releaseAt: NOW - 1 }];
  for (const s of lost) {
    const v = lostAccessView(s, NOW, () => '5 Nov 2026, 3:04 pm');
    all.push(v.title, v.body);
  }
  for (const c of ['BAD_EMAIL', 'SYNC_OFF', 'SYNC_FIRST', 'LOST_STILL_ALIVE', 'LOST_NOT_READY', 'LOST_DIFFERENT_ACCOUNT']) all.push(explainRecovery(coded(c)));
  all.push(emailProblem('') ?? '', emailProblem('x') ?? '', emailProblem('a'.repeat(400)) ?? '');
  assert.equal(EMAIL_DISCLOSURE.length, 4);
  for (const text of all) {
    assert.ok(text.length > 0);
    assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, text);
    assert.doesNotMatch(text, /\b[A-Z]{4,}\b/, text);
  }
});
