import { test } from 'node:test';

test.todo('plural: one and thousands separators (re-export from dl-text)');
test.todo('formatBytes: table values, 0, 999, NaN, -5');
test.todo('formatSpeed: table values, 0, NaN');
test.todo('formatEta: table values, null, Infinity');
test.todo('progressOf: percent, null size, done record, clamp');
test.todo('etaSeconds: normal, speed 0, size null');
test.todo('filterRecords: every filter kind, order kept');
test.todo('sortRecords: name, size with nulls last both ways, speed and eta from the map, stable, no mutation');
test.todo('parseAddInput: mixed input, max, empty');
test.todo('statusText: every state, queue schedule, done folder, failed error');
