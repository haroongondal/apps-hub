// Design with AI keys: which service a key belongs to, the request each service wants, and the
// hand-over from one key to the next. Pure, so node --test runs it. Keep in step with
// apps/design-editor/ai-keys.js.
export type Service = 'groq' | 'gemini';
export const SERVICES: Record<Service, { name: string; url: string; model: string }> = {
  groq: { name: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-120b' },
  gemini: { name: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-3.5-flash-lite' },
};

// Same shape as the desktop's reply: HTTP errors carry status and no `error`.
export type AiReply = { ok: boolean; status: number; json?: object; error?: 'nokey' | 'offline' | 'timeout' | 'bad' };

// Groq keys start gsk_ and Gemini keys start AIza, so the key alone says where it goes.
export const serviceOf = (key: string): Service | null => (key.startsWith('gsk_') ? 'groq' : key.startsWith('AIza') ? 'gemini' : null);
// What the page may see of a key: the service and the last four characters, never the key.
export const labelOf = (key: string) => `${SERVICES[serviceOf(key)!].name} key ending ${key.slice(-4)}`;

// `body` is the page's request after aiSanitise. Gemini's OpenAI endpoint takes max_tokens and has no reasoning_effort here (as in Inflow).
export function requestFor(service: Service, body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body, model: SERVICES[service].model };
  if (service === 'gemini') {
    out.max_tokens = out.max_completion_tokens;
    delete out.max_completion_tokens;
    delete out.reasoning_effort;
  }
  return out;
}

// Another key can fix a refused key (401, 403, or Gemini's 400 for a key it does not know) or a key at its limit (429); nothing else.
const refused = (r: AiReply) => r.status === 401 || r.status === 403 || (r.status === 400 && /API key not valid|API_KEY_INVALID/.test(JSON.stringify(r.json ?? '')));

export type Post = (url: string, key: string, body: Record<string, unknown>) => Promise<AiReply>;

/** One per app. `post` never throws. Answers the last useful reply: a limit beats a refusal, since waiting can fix it. */
export function createSender() {
  let current = 0; // the key in use; it changes only when that key is refused or at its limit
  return async function send(keys: string[], body: Record<string, unknown>, post: Post): Promise<AiReply> {
    if (!keys.length) return { ok: false, status: 0, error: 'nokey' };
    let limited: AiReply | undefined;
    let denied: AiReply | undefined;
    for (let n = 0; n < keys.length; n++) {
      const i = (current + n) % keys.length;
      const service = serviceOf(keys[i])!;
      const reply = await post(SERVICES[service].url, keys[i], requestFor(service, body));
      if (reply.ok) {
        current = i;
        return reply;
      }
      if (reply.status === 429) limited ??= reply;
      else if (refused(reply)) denied ??= reply;
      else return reply;
    }
    return (limited ?? denied)!;
  };
}
