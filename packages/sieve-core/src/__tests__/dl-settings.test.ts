import { test } from 'node:test';

test.todo('undefined, a string and a wrong version give DEFAULT_DOWNLOADS');
test.todo('DEFAULT_DOWNLOADS equals the spelled-out literal');
test.todo('the default lists have 56 extensions, no duplicates, 31 MIME types, and other has no extensions');
test.todo('minMb is rounded and clamped, else 5');
test.todo('parts is rounded and clamped, else 1');
test.todo('kbPerSecond is rounded and clamped, else 1000');
test.todo('extension lists are trimmed, lowercased, filtered, deduplicated and capped');
test.todo('a non-array extension list gives the default list');
test.todo('MIME types are lowercased, filtered and deduplicated');
test.todo('categories fill six entries in CATEGORY_IDS order');
test.todo('bad folder names give the default folder, a padded one is trimmed');
test.todo('other never keeps extensions, and the first entry of an id wins');
test.todo('empty or non-array queues give the default queue');
test.todo('a broken queue entry is repaired');
test.todo('bad days give all seven, nine queues keep eight');
test.todo('a duplicate queue id becomes q<position>, a valid queue is kept');
test.todo('validate is idempotent');
