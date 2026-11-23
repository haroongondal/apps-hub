import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Clip } from 'clipboard-core';
import { formatIban, isValidIban, isValidS10, recognise, smartActions } from '../smart.ts';

const clip = (text: string | null, kind: Clip['kind'] = 'text'): Clip => ({
  id: 1, at: 0, kind, text, mime: 'text/plain', source: null, via: 'app', grabMs: null, pinned: false,
});
const kinds = (text: string) => recognise(clip(text)).map((f) => f.kind);
const one = (text: string) => {
  const actions = smartActions(clip(text));
  assert.equal(actions.length, 1, `one action for ${JSON.stringify(text)}, got ${JSON.stringify(actions)}`);
  return actions[0];
};
const ALLOWED_URI = /^(https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*)?|tel:\+?\d{3,15}|geo:0,0\?q=[A-Za-z0-9%._~-]+)$/;

test('sensitive and hidden clips are never recognised', () => {
  const text = 'Call 0300-1234567, IBAN PK36SCBL0000001123456702, https://example.com';
  assert.deepEqual(recognise(clip(text, 'secret')), []);
  assert.deepEqual(recognise(clip(text, 'code')), []);
  assert.deepEqual(recognise(clip(null, 'secret')), []);
  assert.deepEqual(recognise(clip('content://media/1', 'image')), []);
  assert.deepEqual(recognise(clip(text)).map((f) => f.kind), ['link', 'phone', 'iban']);
});

test('links: http and https only, trailing punctuation dropped', () => {
  const a = one('see https://example.com/path?q=1.');
  assert.deepEqual([a.label, a.uri, a.accessibilityLabel], ['Open link', 'https://example.com/path?q=1', 'Open link example.com']);
  assert.equal(one('HTTP://Example.com/x)').uri, 'http://Example.com/x');
  for (const text of [
    'javascript:alert(1)', 'intent://scan/#Intent;scheme=zxing;end', 'file:///sdcard/a.pdf', 'content://x', 'ftp://example.com',
    'https://localhost/x', 'https://exämple.com', 'https://user@example.com', 'market://details?id=x',
  ]) {
    assert.deepEqual(kinds(text), [], text);
  }
});

test('phone numbers: E.164 and Pakistani mobile formats open the dialer', () => {
  for (const [text, dial] of [
    ['0300-1234567', '03001234567'],
    ['call me on 0321 1234567 tonight', '03211234567'],
    ['+92 300 1234567', '+923001234567'],
    ['+92-300-1234567', '+923001234567'],
    ['+44 20 7946 0958', '+442079460958'],
    ['Ali 0300-1234567 12 Nov', '03001234567'],
  ]) {
    const a = one(text);
    assert.deepEqual([a.kind, a.label, a.uri], ['phone', 'Call', `tel:${dial}`], text);
  }
  for (const text of ['2024-11-23', 'Order 12345678', '0300-12345', '1234567890123', 'Rs 3,000,000', 'v1.2.3-4567']) {
    assert.deepEqual(kinds(text), [], text);
  }
});

test('IBAN: country length and mod-97, formatted copy', () => {
  assert.ok(isValidIban('GB82WEST12345698765432'));
  assert.ok(isValidIban('DE89370400440532013000'));
  assert.ok(isValidIban('PK36SCBL0000001123456702'));
  assert.ok(!isValidIban('GB82WEST12345698765431'));
  assert.ok(!isValidIban('PK36SCBL000000112345670'));
  assert.ok(!isValidIban('ZZ82WEST12345698765432'));
  assert.equal(formatIban('PK36SCBL0000001123456702'), 'PK36 SCBL 0000 0011 2345 6702');
  const a = one('Send to PK36 SCBL 0000 0011 2345 6702 THANKS');
  assert.deepEqual([a.kind, a.label, a.copy, a.uri], ['iban', 'Copy IBAN', 'PK36 SCBL 0000 0011 2345 6702', undefined]);
  assert.equal(one('GB82WEST12345698765432').copy, 'GB82 WEST 1234 5698 7654 32');
  for (const text of ['GB82WEST12345698765431', 'GB82 WEST 1234 5698 7654 3', 'AB12CDEF34567890', 'account 0123456789012345']) {
    assert.deepEqual(kinds(text), [], text);
  }
});

test('tracking numbers open the named carrier page', () => {
  const cases: Array<[string, string]> = [
    ['1Z999AA10123456784', 'https://www.ups.com/track?tracknum=1Z999AA10123456784'],
    ['JD014600006281230704', 'https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=JD014600006281230704'],
    ['9400111899223197428490', 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223197428490'],
    ['RR473124829PK', 'https://ep.gov.pk/emtts/EPTrack_Live.aspx?ArticleIDz=RR473124829PK'],
    ['Your FedEx parcel 123456789012 is on its way', 'https://www.fedex.com/fedextrack/?trknbr=123456789012'],
    ['DHL waybill 1234567890', 'https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=1234567890'],
    ['TCS: shipment 779412345678 booked', 'https://www.tcsexpress.com/track/779412345678'],
    ['Leopards CN KI7512345678', 'https://www.leopardscourier.com/shipment_tracking_view?cn_number=KI7512345678'],
    ['M&P consignment 12345678', 'https://www.mulphilog.com/tracking/12345678'],
    ['Pakistan Post article LP473124829CN', 'https://ep.gov.pk/emtts/EPTrack_Live.aspx?ArticleIDz=LP473124829CN'],
  ];
  for (const [text, uri] of cases) {
    const a = one(text);
    assert.deepEqual([a.kind, a.label, a.uri], ['tracking', 'Track parcel', uri], text);
  }
});

test('a number with no carrier, or a bad check digit, gives nothing', () => {
  assert.ok(isValidS10('RR473124829PK'));
  assert.ok(!isValidS10('RR473124828PK'));
  for (const text of [
    'Tracking number 123456789012', 'Your parcel 1234567890 ships today', 'RR473124828PK', 'LP473124829CN',
    '1Z999AA1012345678', 'Invoice 123456789012345', 'TCS 0300-1234567',
  ]) {
    assert.ok(!kinds(text).includes('tracking'), text);
  }
});

test('addresses: number plus street word, house and street, or a UK postcode', () => {
  const a = one('221B Baker Street\nLondon NW1 6XE');
  assert.deepEqual([a.kind, a.label], ['address', 'Open map']);
  assert.equal(a.uri, 'geo:0,0?q=221B%20Baker%20Street%2C%20London%20NW1%206XE');
  assert.equal(one('1600 Amphitheatre Parkway, Mountain View, CA').kind, 'address');
  assert.equal(one('House # 45, Street No. 7, F-7/2, Islamabad').kind, 'address');
  assert.equal(one('Deliver to: SW1A 1AA').kind, 'address');
  assert.equal(one("Meet at 12 O'Brien Road (back gate)").uri, "geo:0,0?q=Meet%20at%2012%20O%27Brien%20Road%20%28back%20gate%29");
  for (const text of [
    'I have 3 dogs and 2 cats', 'Version 2 Drive update', 'Step 2 Take the Road less travelled', 'Ordered 3 Dr Pepper',
    'Chapter 5 St Johns', 'Lahore 54000', 'Meeting at 5 pm', 'The road to 2025', 'room 12 street level',
  ]) {
    assert.deepEqual(kinds(text), [], text);
  }
});

test('one action of each kind at most, and every uri uses an allowed scheme', () => {
  const text = 'https://a.example.com and https://b.example.com, 0300-1234567 or 0321-7654321, FedEx 123456789012\n10 Downing Street';
  const actions = smartActions(clip(text));
  assert.deepEqual(actions.map((a) => a.kind), ['link', 'phone', 'tracking', 'address']);
  for (const a of actions) if (a.uri) assert.match(a.uri, ALLOWED_URI);
  assert.equal(actions[0].uri, 'https://a.example.com');
  assert.equal(actions[1].uri, 'tel:03001234567');
});

test('long clips are scanned only at the start', () => {
  assert.deepEqual(kinds(`${'x '.repeat(1500)}0300-1234567`), []);
});
