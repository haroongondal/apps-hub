// Design with AI keys: which service a key belongs to, the request each service wants, and the
// hand-over from one key to the next. Pure, so node --test runs it. Keep in step with
// apps/design-editor-mobile/src/editor/ai-keys.ts.
export const SERVICES = {
  groq: { name: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-120b' },
  gemini: { name: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-3.5-flash-lite' },
};

// Groq keys start gsk_ and Gemini keys start AIza, so the key alone says where it goes.
export const serviceOf = key => (key.startsWith('gsk_') ? 'groq' : key.startsWith('AIza') ? 'gemini' : null);
// What the page may see of a key: the service and the last four characters, never the key.
export const labelOf = key => `${SERVICES[serviceOf(key)].name} key ending ${key.slice(-4)}`;

// `body` is the page's request after aiSanitise. Gemini's OpenAI endpoint takes max_tokens and has no reasoning_effort here (as in Inflow).
export function requestFor(service, body) {
  const out = { ...body, model: SERVICES[service].model };
  if (service === 'gemini') {
    out.max_tokens = out.max_completion_tokens;
    delete out.max_completion_tokens;
    delete out.reasoning_effort;
  }
  return out;
}

// Another key can fix a refused key (401, 403, or Gemini's 400 for a key it does not know) or a key at its limit (429); nothing else.
const refused = r => r.status === 401 || r.status === 403 || (r.status === 400 && /API key not valid|API_KEY_INVALID/.test(JSON.stringify(r.json ?? '')));

/** One per app. `post(url, key, body)` resolves { ok, status, json?, error? } and never throws. Answers the last useful reply: a limit beats a refusal, since waiting can fix it. */
export function createSender() {
  let current = 0; // the key in use; it changes only when that key is refused or at its limit
  return async function send(keys, body, post) {
    if (!keys.length) return { ok: false, status: 0, error: 'nokey' };
    let limited, denied;
    for (let n = 0; n < keys.length; n++) {
      const i = (current + n) % keys.length;
      const service = serviceOf(keys[i]);
      const reply = await post(SERVICES[service].url, keys[i], requestFor(service, body));
      if (reply.ok) { current = i; return reply; }
      if (reply.status === 429) limited ??= reply;
      else if (refused(reply)) denied ??= reply;
      else return reply;
    }
    return limited ?? denied;
  };
}
