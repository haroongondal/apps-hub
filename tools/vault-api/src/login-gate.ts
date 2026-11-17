const MAX_QUEUE_MS = 10 * 60 * 1000;

export interface Gate { reserve(delayMs: number): number | Promise<number> }

// Each refusal takes the next free slot, so delays run one after another; the cap stops a flood leaving refusals slow for days after it ends.
export class FailureQueue {
  #freeAt = 0;
  #now: () => number;
  constructor(now: () => number) {
    this.#now = now;
  }
  reserve(delayMs: number): number {
    const now = this.#now();
    this.#freeAt = Math.min(Math.max(now, this.#freeAt) + delayMs, now + MAX_QUEUE_MS);
    return this.#freeAt - now;
  }
}

// A plain fetch-style Durable Object (no cloudflare:workers import, so node --test loads it). shortcut: the queue lives in memory, so an eviction after minutes idle starts it fresh; persist it in ctx.storage if that matters.
export class LoginGate {
  #queue = new FailureQueue(() => Date.now());
  async fetch(req: Request): Promise<Response> {
    const delay = Number(new URL(req.url).searchParams.get('delay'));
    return new Response(String(this.#queue.reserve(delay >= 0 && delay <= MAX_QUEUE_MS ? delay : 0)));
  }
}

export interface GateNamespace { idFromName(name: string): unknown; get(id: unknown): { fetch(url: string): Promise<Response> } }

export function durableGate(ns: GateNamespace): Gate {
  return {
    async reserve(delayMs) {
      const res = await ns.get(ns.idFromName('login-gate')).fetch(`https://login-gate/?delay=${delayMs}`);
      const wait = Number(await res.text());
      if (!res.ok || !(wait >= 0 && wait <= MAX_QUEUE_MS)) throw new Error(`Login gate answered ${res.status}.`);
      return wait;
    },
  };
}
