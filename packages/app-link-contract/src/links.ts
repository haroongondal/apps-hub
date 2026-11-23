import { defineAction } from './action.ts';
import type { ActionResult } from './action.ts';

// `context` is untrusted (other people's text or AI output): Deputy puts it only in the untrusted block.
export const PROPOSE_TASK = defineAction({
  app: 'deputy',
  name: 'PROPOSE_TASK',
  screen: true,
  extras: {
    task: { type: 'string', max: 300, required: true },
    context: { type: 'string', max: 2000 },
    apps: { type: 'stringArray', max: 20 },
    ref: { type: 'long' },
  },
  description: "Opens Deputy's draft screen with a proposed task; nothing runs until the owner starts it there",
});

export const PROPOSE_TASK_RESULTS = {
  handed_over: { status: 'done', code: 'handed_over' },
  cancelled: { status: 'cancelled', code: 'cancelled' },
} as const satisfies Record<string, ActionResult>;

export const ADD_TODO = defineAction({
  app: 'inflow',
  name: 'ADD_TODO',
  screen: true,
  extras: {
    title: { type: 'string', max: 200, required: true },
    dueAt: { type: 'long' },
    note: { type: 'string', max: 500 },
    source: { type: 'string', max: 40 },
  },
  description: 'Opens Inflow with a filled-in to-do; it is saved only when the owner taps Add',
});

export const ADD_TODO_RESULTS = {
  added: { status: 'done', code: 'added' },
  cancelled: { status: 'cancelled', code: 'cancelled' },
} as const satisfies Record<string, ActionResult>;

// Data-free on purpose: no extras ever, so receivers re-read the shares, which keep their own guard.
export const CHANGED_PING = Object.freeze({
  action: 'com.haroon.autopilot.CHANGED',
  targetPackage: 'com.haroon.halo',
});
