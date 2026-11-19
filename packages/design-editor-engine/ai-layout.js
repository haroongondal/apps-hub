// Pure request and reply handling for "Design with AI". No DOM, no Node API:
// it loads as a plain <script> (globalThis.AiLayout) and through require() in node --test.
(function (root) {
  const MODEL = 'openai/gpt-oss-120b'; // Groq's; the app swaps in the model of whichever key it uses (ai-keys.js)
  const FONTS = ['Atkinson Hyperlegible Next', 'Jost', 'Playfair Display', 'Dancing Script'];
  const TYPES = ['text', 'rect', 'circle', 'star', 'line'];
  const ALIGNS = ['left', 'center', 'right'];
  const MAX_ITEMS = 30;
  const MAX_TEXT = 300;
  const TOOL = 'make_layout';
  const DEFAULT_FILL = '#1d2433';
  const DEFAULT_BG = '#ffffff';
  // plain: true marks a message written for the person, so the page may show it as is
  const noLayout = () => Object.assign(new Error('The reply had no layout. Try again.'), { plain: true });

  const fraction = { type: 'number', minimum: 0, maximum: 1 };
  const INPUT_SCHEMA = {
    type: 'object',
    properties: {
      bg: { type: 'string', description: 'Page background as #rrggbb.' },
      items: {
        type: 'array',
        maxItems: MAX_ITEMS,
        description: 'Elements in paint order, back to front.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: TYPES },
            x: { ...fraction, description: 'Centre, as a fraction of the page width.' },
            y: { ...fraction, description: 'Centre, as a fraction of the page height.' },
            w: { ...fraction, description: 'Width, as a fraction of the page width.' },
            h: { ...fraction, description: 'Height, as a fraction of the page height.' },
            text: { type: 'string', maxLength: MAX_TEXT },
            size: { type: 'number', minimum: 0.01, maximum: 0.3, description: 'Font size, as a fraction of the shorter page side.' },
            font: { type: 'string', enum: FONTS },
            bold: { type: 'boolean' },
            italic: { type: 'boolean' },
            align: { type: 'string', enum: ALIGNS },
            fill: { type: 'string', description: 'Colour as #rrggbb. Text colour for text, line colour for a line.' },
            round: { type: 'number', minimum: 0, maximum: 0.5, description: 'Rectangle corner rounding.' },
            stroke: { type: 'number', minimum: 0.002, maximum: 0.05, description: 'Line thickness, as a fraction of the shorter side.' },
          },
          required: ['type', 'x', 'y', 'w', 'h'],
        },
      },
    },
    required: ['bg', 'items'],
  };

  function systemPrompt(W, H) {
    return [
      `You lay out one design page of ${W}×${H} pixels by calling the ${TOOL} tool exactly once. Reply with the tool call only.`,
      'Use only these element types: text, rect, circle, star, line.',
      'Positions and sizes are fractions of the page from 0 to 1: x and y are the centre of the element, w and h its width and height. Text size is a fraction of the shorter page side (0.01 to 0.3).',
      `Fonts: ${FONTS.join(', ')}. Use Playfair Display or Dancing Script for display lines, Jost or Atkinson Hyperlegible Next for the rest.`,
      'Colours are #rrggbb. Make the page legible: strong contrast between text and what lies behind it, a clear title, generous margins, nothing outside the page, and elements listed back to front.',
      `Use at most ${MAX_ITEMS} elements and at most ${MAX_TEXT} characters per text.`,
    ].join('\n');
  }

  // tool_choice stays 'auto': the system prompt asks for the call and parseReply checks it.
  function buildRequest(prompt, W, H) {
    return {
      model: MODEL,
      max_completion_tokens: 8000,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: systemPrompt(W, H) },
        { role: 'user', content: String(prompt).trim() },
      ],
      tools: [{ type: 'function', function: { name: TOOL, description: 'Place the elements of the design on the page.', parameters: INPUT_SCHEMA } }],
      tool_choice: 'auto',
    };
  }

  const num = (v, lo, hi, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
  const colour = (v, def) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : def);

  function cleanItem(raw) {
    if (!raw || typeof raw !== 'object' || !TYPES.includes(raw.type)) return null;
    const w = num(raw.w, 0, 1, 0.2), h = num(raw.h, 0, 1, 0.2);
    // x and y are the centre (a line's bounding box too), so the whole item stays on the page
    const item = { type: raw.type, x: num(raw.x, w / 2, 1 - w / 2, 0.5), y: num(raw.y, h / 2, 1 - h / 2, 0.5), w, h };
    item.fill = colour(raw.fill, DEFAULT_FILL);
    if (raw.type === 'text') {
      const text = typeof raw.text === 'string' ? Array.from(raw.text).slice(0, MAX_TEXT).join('') : '';
      if (!text.trim()) return null;
      item.text = text;
      item.size = num(raw.size, 0.01, 0.3, 0.06);
      item.font = FONTS.includes(raw.font) ? raw.font : FONTS[0];
      item.bold = raw.bold === true;
      item.italic = raw.italic === true;
      item.align = ALIGNS.includes(raw.align) ? raw.align : 'left';
    } else if (raw.type === 'rect' && raw.round !== undefined) {
      item.round = num(raw.round, 0, 0.5, 0);
    } else if (raw.type === 'line') {
      item.stroke = num(raw.stroke, 0.002, 0.05, 0.005);
    }
    return item;
  }

  // reply is the parsed JSON of a chat completion. The tool's arguments arrive as a JSON string.
  function parseReply(reply) {
    const calls = reply && reply.choices && reply.choices[0] && reply.choices[0].message && reply.choices[0].message.tool_calls;
    const call = Array.isArray(calls) ? calls.find((c) => c && c.function && c.function.name === TOOL) : undefined;
    let input;
    try { input = call && JSON.parse(call.function.arguments); } catch { input = undefined; }
    if (!input || typeof input !== 'object' || !Array.isArray(input.items)) throw noLayout();
    const items = input.items.slice(0, MAX_ITEMS).map(cleanItem).filter(Boolean);
    if (!items.length) throw noLayout();
    return { bg: colour(input.bg, DEFAULT_BG), items };
  }

  const AiLayout = { MODEL, FONTS, buildRequest, parseReply };
  root.AiLayout = AiLayout;
  if (typeof module !== 'undefined' && module.exports) module.exports = AiLayout;
})(typeof globalThis !== 'undefined' ? globalThis : this);
