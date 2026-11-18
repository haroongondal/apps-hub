import { AiError, RELATIONS, type AiPort, type Segment } from './types.ts';

export interface OpenAiOptions {
  apiKey: string;
  baseUrl?: string;
  chatModel?: string;
  embedModel?: string;
  transcribeModel?: string;
  fetch?: typeof fetch;
}

/** React Native's FormData takes `{ uri, name, type }` for a file on disk; Node takes a Blob. */
export type UploadFile = Blob | { uri: string; name: string; type: string };

export interface OpenAiPort extends AiPort {
  transcribe(file: UploadFile): Promise<Segment[]>;
  readImage(jpegBase64: string): Promise<string>;
}

export const EMBED_DIMS = 512;

const EXTRACT_PROMPT = `You build a personal knowledge graph. The user message is numbered segments of one document.
Return JSON with:
- concepts: the distinct topics, people, tools, frameworks and places it is about. "label" is the clearest name; "aliases" are other names used for it (abbreviations, spellings).
- atoms: the atomic ideas, claims, insights and action items, each one self-contained sentence; "segment" is the number of the segment it comes from; "concepts" are the labels it is about.
- relations: links between two concept labels, "type" one of ${RELATIONS.join(', ')}, "weight" 0 to 1 for how strongly the text supports it, "evidence" a short quote.
Skip filler and generic concepts such as "idea" or "thing". Write in the document's language.`;

const ANSWER_PROMPT = `Answer the question using only the numbered sources from the user's own library.
Cite every claim with its source number in square brackets, like [2] or [1, 3].
If the sources don't answer it, say so in one sentence. Be brief.`;

const IMAGE_PROMPT = `Transcribe all text in this image verbatim. Then, on a new line starting "Description:", describe what it shows in two sentences.`;

const str = { type: 'string' } as const;
const list = (items: object) => ({ type: 'array', items }) as const;
const obj = (properties: Record<string, object>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties }) as const;
const GRAPH_SCHEMA = obj({
  concepts: list(obj({ label: str, aliases: list(str) })),
  atoms: list(obj({ text: str, segment: { type: 'integer' }, concepts: list(str) })),
  relations: list(obj({ from: str, to: str, type: { type: 'string', enum: [...RELATIONS] }, weight: { type: 'number' }, evidence: str })),
});

export function openAiPort(o: OpenAiOptions): OpenAiPort {
  const base = (o.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const chatModel = o.chatModel ?? 'gpt-4o-mini';
  const embedModel = o.embedModel ?? 'text-embedding-3-small';
  const doFetch = o.fetch ?? fetch;

  async function call(path: string, body: string | FormData): Promise<Record<string, unknown>> {
    if (!o.apiKey.trim()) throw new AiError('auth', 'No API key is set. Add your key in AI settings.');
    const headers: Record<string, string> = { Authorization: `Bearer ${o.apiKey.trim()}` };
    if (typeof body === 'string') headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { method: 'POST', headers, body });
    } catch {
      throw new AiError('offline', "Nexus couldn't reach the AI service. Check your connection; queued items continue when it's back.");
    }
    const text = await res.text();
    if (res.status === 401 || res.status === 403) throw new AiError('auth', `The AI service refused the API key (HTTP ${res.status}). Check your key in AI settings.`);
    if (res.status === 429) throw new AiError('rate', 'The AI service is rate-limiting this key. Nexus tries again later.');
    if (res.status >= 500) throw new AiError('server', `The AI service had a problem (HTTP ${res.status}). Nexus tries again.`);
    if (!res.ok) throw new AiError('bad_request', `The AI service rejected the request (HTTP ${res.status}): ${text.slice(0, 200)}`);
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new AiError('bad_reply', 'The AI service sent a reply Nexus could not read.');
    }
  }

  async function chat(messages: object[], format?: object): Promise<string> {
    const reply = await call('/chat/completions', JSON.stringify({ model: chatModel, messages, ...(format ? { response_format: format } : {}) }));
    const content = (reply.choices as { message?: { content?: unknown } }[] | undefined)?.[0]?.message?.content;
    if (typeof content !== 'string') throw new AiError('bad_reply', 'The AI service sent an empty reply.');
    return content;
  }

  return {
    async embed(texts) {
      const reply = await call('/embeddings', JSON.stringify({ model: embedModel, input: texts, dimensions: EMBED_DIMS }));
      const data = reply.data as { index: number; embedding: number[] }[] | undefined;
      if (!Array.isArray(data) || data.length !== texts.length) throw new AiError('bad_reply', 'The AI service sent the wrong number of embeddings.');
      return [...data].sort((a, b) => a.index - b.index).map((d) => Float32Array.from(d.embedding));
    },

    async extract(segments) {
      const content = await chat(
        [
          { role: 'system', content: EXTRACT_PROMPT },
          { role: 'user', content: segments.map((s, i) => `[${i}] ${s}`).join('\n\n') },
        ],
        { type: 'json_schema', json_schema: { name: 'knowledge_graph', strict: true, schema: GRAPH_SCHEMA } },
      );
      try {
        return JSON.parse(content) as unknown;
      } catch {
        throw new AiError('bad_reply', 'The AI service sent a graph Nexus could not read.');
      }
    },

    answer(question, sources) {
      return chat([
        { role: 'system', content: ANSWER_PROMPT },
        { role: 'user', content: `${sources.map((s, i) => `[${i + 1}] ${s}`).join('\n\n')}\n\nQuestion: ${question}` },
      ]);
    },

    readImage(jpegBase64) {
      return chat([
        {
          role: 'user',
          content: [
            { type: 'text', text: IMAGE_PROMPT },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpegBase64}` } },
          ],
        },
      ]);
    },

    async transcribe(file) {
      const form = new FormData();
      form.append('file', file as Blob);
      form.append('model', o.transcribeModel ?? 'whisper-1');
      form.append('response_format', 'verbose_json');
      const reply = await call('/audio/transcriptions', form);
      const segments = reply.segments as { start: number; end: number; text: string }[] | undefined;
      if (Array.isArray(segments)) return segments.map((s) => ({ text: s.text.trim(), locator: { startSec: s.start, endSec: s.end } }));
      return typeof reply.text === 'string' ? [{ text: reply.text, locator: null }] : [];
    },
  };
}
