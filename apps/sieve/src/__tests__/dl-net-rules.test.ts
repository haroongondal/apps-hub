import { test } from 'node:test';

test.todo('allowRule has the exact shape');
test.todo('refererRule has the exact shape and outranks the allow rule');
test.todo('recordRules numbers rules from 1000 in record-id order');
test.todo('recordRules skips done records and empty referrers');
test.todo('recordRules adds one rule for url and one for a different finalUrl, none duplicated');
test.todo('recordRules stops at 1000 rules');
test.todo('addProbeRule removes the id in the call that adds it');
test.todo('addProbeRule wraps its counter at 1000');
test.todo('addProbeRule returns a remover that removes the rule');
test.todo('addProbeRule with an empty referrer returns a no-op');
