import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudflareMailer, type SendEmailBinding } from '../mailer.ts';

test('wraps the native send_email binding call with the right message shape', async () => {
  const calls: unknown[] = [];
  const binding: SendEmailBinding = {
    async send(message) {
      calls.push(message);
      return { messageId: 'abc123' };
    },
  };
  const mailer = createCloudflareMailer(binding, 'strongroom@haroongondal.com');
  await mailer.send('owner@example.com', 'Subject line', 'Body text');
  assert.deepEqual(calls, [{ to: 'owner@example.com', from: 'strongroom@haroongondal.com', subject: 'Subject line', text: 'Body text' }]);
});

test('a rejection from the native binding propagates as a rejection from the wrapped Mailer', async () => {
  const err = Object.assign(new Error('not verified'), { code: 'E_SENDER_NOT_VERIFIED' });
  const binding: SendEmailBinding = { send: async () => { throw err; } };
  const mailer = createCloudflareMailer(binding, 'strongroom@haroongondal.com');
  await assert.rejects(() => mailer.send('owner@example.com', 'Subject', 'Text'), err);
});
