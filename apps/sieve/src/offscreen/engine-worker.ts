// Stub standing in for the engine until Task 3.10 replaces this body.
import type { WorkerMessage, WorkerRequest } from './protocol.ts';

const scope = self as unknown as { onmessage: (e: MessageEvent<WorkerRequest>) => void; postMessage(m: WorkerMessage): void };

scope.onmessage = async ({ data: { id, cmd, payload } }) => {
  if (cmd === 'config') await new Promise((r) => setTimeout(r, 50)); // stands in for engine.start()
  const result = cmd === 'add' ? { ids: (payload as unknown[]).map((_, i) => 'stub' + i) } : { ok: true };
  scope.postMessage({ reply: id, result });
};
