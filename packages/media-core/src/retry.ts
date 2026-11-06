import { walkLadder } from './budget.ts';
import type { Planned, SizePlan } from './types.ts';

const RETRY_FACTOR = 0.97;

// ok: true with the same plan means publish the file, not run it again.
export function nextSizeAttempt(plan: SizePlan, actualBytes: number): Planned<SizePlan> {
  if (!Number.isFinite(actualBytes) || actualBytes < 0) return { ok: false, reason: 'invalid', detail: 'The output size is unknown.' };
  if (actualBytes <= plan.targetBytes) return { ok: true, plan };
  if (plan.attempt === 3) return { ok: false, reason: 'gave-up' };
  const audioBytes = plan.plannedBytes - plan.plannedVideoBytes - plan.overheadBytes;
  const actualVideoBytes = actualBytes - audioBytes - plan.overheadBytes;
  if (actualVideoBytes <= 0) return { ok: false, reason: 'gave-up', detail: 'The output has no room left for video.' };
  const videoBps = Math.round(plan.videoBps * plan.plannedVideoBytes / actualVideoBytes * RETRY_FACTOR);
  const walk = walkLadder({ width: plan.width, height: plan.height, fps: plan.fpsCap }, videoBps, plan.encoder);
  const plannedVideoBytes = Math.round(plan.plannedVideoBytes * videoBps / plan.videoBps);
  return {
    ok: true,
    plan: {
      ...plan, rung: walk.rung, width: walk.width, height: walk.height, videoBps,
      plannedVideoBytes, plannedBytes: plannedVideoBytes + audioBytes + plan.overheadBytes,
      attempt: (plan.attempt + 1) as 2 | 3,
    },
  };
}
