import { test } from 'node:test';

test.todo('bucket worked example, step by step');
test.todo('burst sizes and every no-limit rate value');
test.todo('setRate refills at the old rate, caps tokens, turns the limit off, no NaN after Infinity');
test.todo('simulated drain of 1,000,000 bytes at 100,000 per second');
test.todo('two consumers sharing one bucket');
test.todo('meter worked example, empty meter, span clamp, custom window, time going backwards');
