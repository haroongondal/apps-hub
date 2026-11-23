import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileFilters } from '@apps-hub/sieve-core/src/compile.ts';
import { LISTS } from '../lists.ts';

// YouTube's player reads whether static.doubleclick.net/instream/ad_status.js arrived and reports it; the Ads list blocks that host.
test("the Ads list's extra lines let YouTube's ad_status.js through the doubleclick block, for YouTube pages only", async () => {
  const { rules } = await compileFilters(['||static.doubleclick.net^', ...(LISTS.ads.extra ?? [])].join('\n'), { firstId: 1, regexLimit: 1000 });
  const block = rules.find((r) => r.action.type === 'block');
  const allow = rules.find((r) => r.action.type === 'allow' && r.condition.urlFilter === '||static.doubleclick.net/instream/ad_status.js');
  assert.ok(block && allow, 'both rules compile');
  assert.deepEqual(allow.condition.initiatorDomains, ['youtube.com', 'youtube-nocookie.com']);
  assert.deepEqual(allow.condition.resourceTypes, ['script']);
  assert.ok((allow.priority ?? 1) > (block.priority ?? 1), 'the exception outranks the block');
});
