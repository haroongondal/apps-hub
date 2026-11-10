import { test } from 'node:test';

test.todo('minutesOf: 00:00, 22:30, 23:59');
test.todo('isOpen: S1 examples (overnight weekdays, started Friday, Sun and Mon closed)');
test.todo('isOpen: S2 same-day window and its edges');
test.todo('isOpen: S3 no stop closes at midnight');
test.todo('isOpen: S4 equal times are open all day');
test.todo('isOpen: Saturday-only overnight window runs into Sunday');
test.todo('isOpen: a schedule that is off is always open');
test.todo('nextChange: every fixed example');
test.todo('nextChange: off and S4 give null');
test.todo('nextWake: off, one scheduled, two scheduled');
test.todo('queueOf: unknown id falls back to the first queue');
test.todo('schedulePlan: worked example four ways');
test.todo('schedulePlan: maxParallel 3 starts the three oldest');
test.todo('schedulePlan: equal addedAt ties break by id');
test.todo('schedulePlan: paused, failed, saving and done are never listed');
test.todo('schedulePlan: unknown queue id counts toward the first queue');
test.todo('schedulePlan: nothing is mutated');
