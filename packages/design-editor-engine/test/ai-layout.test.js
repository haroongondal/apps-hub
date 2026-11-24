const test = require('node:test');
const assert = require('node:assert/strict');
const AiLayout = require('../ai-layout.js');

// A chat completion whose one tool call carries the arguments as a JSON string, as Groq sends them.
const reply = (input, name = 'make_layout') => ({
  choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name, arguments: JSON.stringify(input) } }] }, finish_reason: 'tool_calls' }],
});
const text = (o = {}) => ({ type: 'text', x: 0.5, y: 0.5, w: 0.8, h: 0.2, text: 'Hi', size: 0.08, ...o });

test('parses a good tool_use reply', () => {
  const items = [
    text({ font: 'Jost', bold: true, italic: false, align: 'center', fill: '#112233' }),
    { type: 'rect', x: 0.5, y: 0.9, w: 1, h: 0.2, fill: '#ffd43b', round: 0.1 },
  ];
  const out = AiLayout.parseReply(reply({ bg: '#eeeeee', items }));
  assert.equal(out.bg, '#eeeeee');
  assert.equal(out.items.length, 2);
  assert.deepEqual(out.items[0], items[0]);
  assert.deepEqual(out.items[1], items[1]);
});

test('repairs bad colours', () => {
  const items = ['red', '#fff', 'url(x)'].map((fill) => ({ type: 'rect', x: 0.5, y: 0.5, w: 0.2, h: 0.2, fill }));
  const out = AiLayout.parseReply(reply({ bg: 'blue', items }));
  assert.equal(out.bg, '#ffffff');
  assert.deepEqual(out.items.map((i) => i.fill), ['#1d2433', '#1d2433', '#1d2433']);
});

test('replaces unknown fonts with Atkinson Hyperlegible Next', () => {
  const out = AiLayout.parseReply(reply({ bg: '#ffffff', items: [text({ font: 'Comic Sans' }), text({ font: 'Jost' })] }));
  assert.equal(out.items[0].font, 'Atkinson Hyperlegible Next');
  assert.equal(out.items[1].font, 'Jost');
});

test('clamps numbers', () => {
  const out = AiLayout.parseReply(reply({
    bg: '#ffffff',
    items: [text({ x: 4, y: -2, size: 2 }), { type: 'rect', x: 0.5, y: 0.5, w: 0.2, h: 0.2, round: 9 }, { type: 'line', x: 0.5, y: 0.5, w: 0.5, h: 0, stroke: 5 }],
  }));
  assert.equal(out.items[0].x, 0.6); // centre pulled in so the 0.8 wide text stays on the page
  assert.equal(out.items[0].y, 0.1);
  assert.equal(out.items[0].size, 0.3);
  assert.equal(out.items[1].round, 0.5);
  assert.equal(out.items[2].stroke, 0.05);
});

test('cuts to 30 items and 300 characters of text', () => {
  const items = Array.from({ length: 40 }, () => text({ text: 'x'.repeat(500) }));
  const out = AiLayout.parseReply(reply({ bg: '#ffffff', items }));
  assert.equal(out.items.length, 30);
  assert.equal(out.items[0].text.length, 300);
});

test('drops unknown item types', () => {
  const out = AiLayout.parseReply(reply({ bg: '#ffffff', items: [{ type: 'image', x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, null, 'x', text()] }));
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].type, 'text');
});

test('throws "The reply had no layout. Try again." when there is no tool call', () => {
  const msg = 'The reply had no layout. Try again.';
  assert.throws(() => AiLayout.parseReply({ choices: [{ message: { role: 'assistant', content: 'Sure!' } }] }), { message: msg });
  assert.throws(() => AiLayout.parseReply(reply({ bg: '#fff', items: [] }, 'other_tool')), { message: msg });
  assert.throws(() => AiLayout.parseReply(reply({ bg: '#fff' })), { message: msg });
  assert.throws(() => AiLayout.parseReply({ choices: [{ message: { tool_calls: [{ function: { name: 'make_layout', arguments: '{oops' } }] } }] }), { message: msg });
  assert.throws(() => AiLayout.parseReply(null), { message: msg });
});

test('buildRequest offers the tool and names the page size', () => {
  const b = AiLayout.buildRequest('  a poster  ', 1080, 1350);
  assert.equal(b.model, AiLayout.MODEL);
  assert.equal(b.model, 'openai/gpt-oss-120b');
  assert.equal(b.tools.length, 1);
  assert.equal(b.tools[0].type, 'function');
  assert.equal(b.tools[0].function.name, 'make_layout');
  assert.equal(b.tools[0].function.parameters.type, 'object');
  const system = b.messages[0].content;
  assert.equal(b.messages[0].role, 'system');
  assert.ok(system.includes('1080×1350'));
  assert.ok(system.includes('make_layout'));
  for (const f of AiLayout.FONTS) assert.ok(system.includes(f));
  assert.deepEqual(b.messages[1], { role: 'user', content: 'a poster' });
  assert.ok(!('temperature' in b));
});

test('throws when no item survives the cleaning', () => {
  const msg = 'The reply had no layout. Try again.';
  assert.throws(() => AiLayout.parseReply(reply({ bg: '#000000', items: [{ type: 'image' }] })), { message: msg });
  assert.throws(() => AiLayout.parseReply(reply({ bg: '#000000', items: [] })), { message: msg });
  assert.throws(() => AiLayout.parseReply(reply({ bg: '#000000', items: [text({ text: '   ' }), text({ text: '' })] })), { message: msg });
});

test('marks its own messages as plain', () => {
  assert.throws(() => AiLayout.parseReply(null), { plain: true });
});

test('keeps every item fully inside the page', () => {
  const out = AiLayout.parseReply(reply({
    bg: '#ffffff',
    items: [{ type: 'rect', x: 1, y: 0.5, w: 1, h: 0.2 }, { type: 'rect', x: 0, y: 0, w: 0.5, h: 0.5 }, { type: 'line', x: 1, y: 1, w: 0.4, h: 0.1 }],
  }));
  for (const i of out.items) {
    assert.ok(i.x - i.w / 2 >= 0 && i.x + i.w / 2 <= 1, 'x range');
    assert.ok(i.y - i.h / 2 >= 0 && i.y + i.h / 2 <= 1, 'y range');
  }
  assert.deepEqual([out.items[0].x, out.items[1].x, out.items[1].y], [0.5, 0.25, 0.25]);
});

test('cuts text by characters, not by UTF-16 halves', () => {
  const out = AiLayout.parseReply(reply({ bg: '#ffffff', items: [text({ text: 'a'.repeat(299) + '😀😀' })] }));
  assert.equal(out.items[0].text, 'a'.repeat(299) + '😀');
});

test('the four AI hub states say what to do and which app the button opens, in plain words', () => {
  assert.deepEqual(AiLayout.hubNeeded('hubmissing'), { message: 'AI needs AI hub.', button: 'Install AI hub', open: 'store' });
  assert.deepEqual(AiLayout.hubNeeded('update'), { message: 'AI hub needs an update.', button: 'Update AI hub', open: 'store' });
  assert.deepEqual(AiLayout.hubNeeded('notallowed'), { message: 'AI hub has not allowed Design Editor yet.', button: 'Allow Design Editor in AI hub', open: 'aihub' });
  assert.deepEqual(AiLayout.hubNeeded('nokey'), { message: 'AI hub has no key yet.', button: 'Add a key in AI hub', open: 'aihub' });
  assert.equal(AiLayout.hubNeeded('timeout'), null);
  assert.equal(AiLayout.hubNeeded('constructor'), null);
});
