import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Screen {
  id: string;
  app: string;
  task: string;
  subgoal: string;
  lines: string[];
  answer: string;
  image?: string;
}

export interface PickerResult { id: string; choice: string; top: number; ms: number; correct: boolean; error?: string }
export interface StepResult { id: string; tool: string | null; args?: string; promptMs: number; decodeMs: number; ms: number; valid: boolean; error?: string }

const SYSTEM = 'You operate an Android phone for the owner. Reply with exactly one tool call.';

const tool = (name: string, description: string, properties: object, required: string[]) =>
  ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });

const TOOLS = [
  tool('tap', 'Tap the element with this index.', { index: { type: 'integer' } }, ['index']),
  tool('back', 'Press the back button.', {}, []),
  tool('done', 'The task is finished.', { summary: { type: 'string' } }, ['summary']),
];
const TOOL_NAMES = TOOLS.map((t) => t.function.name);

const state = (s: Screen) => `Task: ${s.task}\nSub-goal: ${s.subgoal}\nScreen (${s.app}):\n${s.lines.join('\n')}`;

const errorMessage = (e: any) => String(e?.message ?? e);

export function pickerRequest(s: Screen): object {
  const criteria: Record<string, string> = {};
  s.lines.forEach((line, i) => {
    const m = /^\[(\d+)\] ?(\S*(?: "[^"]*")?)/.exec(line);
    if (!m) throw new Error(`screen ${s.id}: line ${i + 1} has no [n] index: ${line}`);
    // laya-type deciders cut the question and options to ~192-256 tokens; the full line stays in the state
    criteria[m[1]] = m[2] || line;
  });
  criteria.done = 'The sub-goal is already reached';
  criteria.unsure = 'None of these elements fits';
  return {
    state: state(s),
    questions: {
      next: { type: 'choice', instructions: `Sub-goal: ${s.subgoal}. Which element should be tapped next to reach it?`, criteria },
    },
  };
}

export function pickerResult(s: Screen, body: unknown, ms: number): PickerResult {
  const b = body as any;
  const answer = b?.answers?.next;
  if (b?.error || answer?.choice == null) {
    return { id: s.id, choice: 'error', top: 0, ms, correct: false, error: b?.error ? errorMessage(b.error) : 'no answer in the reply' };
  }
  const choice = String(answer.choice);
  return { id: s.id, choice, top: Number(answer.probabilities?.[choice] ?? 0), ms, correct: choice === s.answer };
}

export function stepRequest(s: Screen, imageDataUrl: string | null, maxTokens = 128): object {
  const text = state(s);
  const content = imageDataUrl ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: imageDataUrl } }] : text;
  return {
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content }],
    tools: TOOLS,
    tool_choice: 'required',
    temperature: 0,
    max_tokens: maxTokens,
  };
}

const parses = (json: unknown) => {
  if (typeof json !== 'string') return false;
  try { JSON.parse(json); return true; } catch { return false; }
};

export function stepResult(s: Screen, body: unknown, ms: number): StepResult {
  const b = body as any;
  // NaN, not 0, when the server sent no timings: a missing figure must not read as measured.
  const times = { promptMs: Number(b?.timings?.prompt_ms ?? NaN), decodeMs: Number(b?.timings?.predicted_ms ?? NaN), ms };
  if (b?.error) return { id: s.id, tool: null, ...times, valid: false, error: errorMessage(b.error) };
  const call = b?.choices?.[0]?.message?.tool_calls?.[0]?.function;
  if (!call?.name) return { id: s.id, tool: null, ...times, valid: false };
  return { id: s.id, tool: String(call.name), args: String(call.arguments ?? ''), ...times, valid: TOOL_NAMES.includes(call.name) && parses(call.arguments) };
}

// Timing leaves out error rows, so a fast refusal or a dead server doesn't pull the median down.
export function summarise(rs: { ms: number; correct?: boolean; valid?: boolean; error?: string }[]) {
  const ms = rs.filter((r) => !r.error).map((r) => r.ms).sort((a, b) => a - b);
  const mid = Math.floor(ms.length / 2);
  const medianMs = ms.length === 0 ? NaN : ms.length % 2 ? ms[mid] : (ms[mid - 1] + ms[mid]) / 2;
  return { ok: rs.filter((r) => r.correct || r.valid).length, total: rs.length, medianMs, maxMs: ms.at(-1) ?? NaN };
}

async function post(url: string, req: object): Promise<unknown> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
    const text = await res.text();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = undefined; }
    if (res.ok && parsed) return parsed;
    return { error: { message: parsed?.error?.message ?? `HTTP ${res.status}: ${text.slice(0, 200)}` } };
  } catch (e) {
    return { error: { message: `request failed: ${errorMessage(e)}` } };
  }
}

async function main(argv: string[]) {
  const [mode, file, ...rest] = argv;
  if ((mode !== 'picker' && mode !== 'step') || !file) {
    console.error('usage: bench.ts picker|step <screens.json> [--url http://127.0.0.1:8080] [--image] [--max-tokens 128]');
    process.exit(2);
  }
  const flag = (name: string) => { const i = rest.indexOf(name); return i < 0 ? undefined : rest[i + 1]; };
  const base = flag('--url') ?? 'http://127.0.0.1:8080';
  const withImage = rest.includes('--image');
  const maxTokens = Number(flag('--max-tokens') ?? 128);
  const screens: Screen[] = JSON.parse(await readFile(file, 'utf8'));
  const dir = path.dirname(file);
  const rows: (PickerResult | StepResult)[] = [];

  console.log(mode === 'picker'
    ? '| screen | choice | answer | top | ms | result |\n|---|---|---|---|---|---|'
    : '| screen | tool | valid | prompt ms | decode ms | ms | error |\n|---|---|---|---|---|---|---|');
  for (const s of screens) {
    let req: object;
    if (mode === 'picker') req = pickerRequest(s);
    else {
      if (withImage && !s.image) throw new Error(`screen ${s.id} has no image, but --image was given`);
      const mime = path.extname(s.image ?? '') === '.png' ? 'image/png' : 'image/jpeg';
      const image = withImage ? `data:${mime};base64,${(await readFile(path.resolve(dir, s.image!))).toString('base64')}` : null;
      req = stepRequest(s, image, maxTokens);
    }
    const t0 = performance.now();
    const body = await post(base + (mode === 'picker' ? '/v1/systemone' : '/v1/chat/completions'), req);
    const ms = Math.round(performance.now() - t0);
    if (mode === 'picker') {
      const r = pickerResult(s, body, ms);
      rows.push(r);
      console.log(`| ${r.id} | ${r.choice} | ${s.answer} | ${r.top.toFixed(3)} | ${r.ms} | ${r.error ?? (r.correct ? 'right' : 'wrong')} |`);
    } else {
      const r = stepResult(s, body, ms);
      rows.push(r);
      console.log(`| ${r.id} | ${r.tool ?? 'no tool call'} ${r.args ?? ''} | ${r.valid} | ${Math.round(r.promptMs)} | ${Math.round(r.decodeMs)} | ${r.ms} | ${r.error ?? ''} |`);
    }
  }
  const sum = summarise(rows);
  console.log(`\n${mode === 'picker' ? 'correct' : 'valid'} ${sum.ok}/${sum.total}, median ${sum.medianMs} ms, max ${sum.maxMs} ms`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
