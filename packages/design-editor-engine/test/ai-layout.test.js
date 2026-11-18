const test = require('node:test');
const assert = require('node:assert/strict');
const AiLayout = require('../ai-layout.js');

const reply = (input, name = 'make_layout') => ({
  content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name, input }],
  stop_reason: 'tool_use',
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
  assert.equal(out.items[0].x, 1);
  assert.equal(out.items[0].y, 0);
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

test('throws "The reply had no layout. Try again." when there is no tool_use block', () => {
  const msg = 'The reply had no layout. Try again.';
  assert.throws(() => AiLayout.parseReply({ content: [{ type: 'text', text: 'Sure!' }] }), { message: msg });
  assert.throws(() => AiLayout.parseReply(reply({ bg: '#fff', items: [] }, 'other_tool')), { message: msg });
  assert.throws(() => AiLayout.parseReply(reply({ bg: '#fff' })), { message: msg });
  assert.throws(() => AiLayout.parseReply(null), { message: msg });
});

test('buildRequest offers the tool and names the page size', () => {
  const b = AiLayout.buildRequest('  a poster  ', 1080, 1350);
  assert.equal(b.model, AiLayout.MODEL);
  assert.equal(b.model, 'claude-sonnet-5-5');
  assert.equal(b.tools.length, 1);
  assert.equal(b.tools[0].name, 'make_layout');
  assert.equal(b.tools[0].input_schema.type, 'object');
  assert.ok(b.system.includes('1080×1350'));
  assert.ok(b.system.includes('make_layout'));
  for (const f of AiLayout.FONTS) assert.ok(b.system.includes(f));
  assert.deepEqual(b.messages, [{ role: 'user', content: 'a poster' }]);
  assert.ok(!('temperature' in b));
});
