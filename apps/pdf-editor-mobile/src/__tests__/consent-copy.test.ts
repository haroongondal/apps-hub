import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as copy from '../nexus/consent-copy.ts';

// AI hub sends chat to Groq, or to Gemini when Groq has no working key; the owner must be told both.
const CHAT_TEXTS = {
  MINUTES_REPLACE: copy.MINUTES_REPLACE,
  MINUTES_FOOTER: copy.MINUTES_FOOTER,
  MINUTES_HINT: copy.MINUTES_HINT,
  SETTINGS_LEAVES: copy.SETTINGS_LEAVES,
  ASK_KEEPS: copy.ASK_KEEPS,
  RECEIPT_START: copy.RECEIPT_START,
  CV_NEW_HINT: copy.CV_NEW_HINT,
  CV_CHANGE_FOOTER: copy.CV_CHANGE_FOOTER,
};

test('every text that says where chat goes names Groq, Gemini and AI hub', () => {
  for (const [name, text] of Object.entries(CHAT_TEXTS)) {
    assert.match(text, /Groq/, name);
    assert.match(text, /Gemini/, name);
    assert.match(text, /AI hub/, name);
  }
});

test('the chat texts say Gemini answers when Groq has no working key', () => {
  for (const name of ['MINUTES_REPLACE', 'MINUTES_FOOTER', 'SETTINGS_LEAVES', 'ASK_KEEPS', 'RECEIPT_START', 'CV_NEW_HINT', 'CV_CHANGE_FOOTER'] as const) {
    assert.match(CHAT_TEXTS[name], /Gemini when Groq has no working key/, name);
  }
});

test('the consent texts name no key of the owner and no old provider', () => {
  for (const [name, text] of Object.entries(CHAT_TEXTS)) assert.doesNotMatch(text, /your (Gemini|Groq)? ?keys?|OpenAI|Anthropic/i, name);
  assert.match(copy.MINUTES_FOOTER, /no keys of its own/);
  assert.match(copy.SETTINGS_LEAVES, /Without AI hub nothing is sent/);
});
