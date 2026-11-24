import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as records from '../records.ts';

test('itemName prefers the chosen name, then the sender, then the app', () => {
  assert.equal(records.itemName({ displayName: 'Ali', sender: '+92300', appLabel: 'Messages' }), 'Ali');
  assert.equal(records.itemName({ displayName: null, sender: '+92300', appLabel: 'Messages' }), '+92300');
  assert.equal(records.itemName({ displayName: null, sender: null, appLabel: 'Messages' }), 'Messages');
});

test('txnName falls back from clean name to counterparty to the direction', () => {
  assert.equal(records.txnName({ label: 'Shaafi', counterparty: 'SHAAFI INTL', direction: 'out' }), 'Shaafi');
  assert.equal(records.txnName({ label: null, counterparty: 'SHAAFI INTL', direction: 'out' }), 'SHAAFI INTL');
  assert.equal(records.txnName({ label: null, counterparty: null, direction: 'in' }), 'Money in');
  assert.equal(records.txnName({ label: null, counterparty: null, direction: 'out' }), 'Money out');
});

test('a destructive confirmation names what goes and says what stays', () => {
  assert.match(records.deleteConversationConfirm('Ali').title, /Ali/);
  assert.match(records.deleteConversationConfirm('Ali').message, /every saved message from Ali/);
  assert.match(records.deleteTxnConfirm().message, /messages it came from stay saved/);
  assert.match(records.disconnectGmailConfirm('a@b.c').message, /Saved emails/);
  assert.match(records.removeGmailSenderConfirm('bank.com').message, /already saved stay/);
  assert.match(records.removeNameConfirm('Ali', '+92300').message, /\+92300/);
  assert.equal(records.deleteTodoConfirm('Pay rent').title, 'Delete “Pay rent”?');
});

test('every confirmation is sentence case with a confirm label and no emoji', () => {
  const all = [
    records.deleteItemConfirm(), records.deleteConversationConfirm('Ali'), records.deleteTxnConfirm(), records.deleteTodoConfirm('x'),
    records.removeNameConfirm('Ali', 's'), records.keepBlockConfirm('Bank'), records.removeGmailSenderConfirm('s'),
    records.disconnectGmailConfirm(null),
  ];
  for (const c of all) {
    assert.ok(c.confirmLabel.length > 0 && c.title.length > 0 && c.message.length > 0);
    assert.doesNotMatch(`${c.title} ${c.message} ${c.confirmLabel}`, /\p{Extended_Pictographic}/u);
    assert.notEqual(c.confirmLabel, c.confirmLabel.toUpperCase());
  }
});
