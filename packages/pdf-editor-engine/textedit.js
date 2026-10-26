const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const fmt = x => String(+x.toFixed(3));
const TEXT_OPS = new Set(['Tj', 'TJ', "'", '"']);

function lexContent(b) {
  const ops = [], stack = [];
  let args = [], argStart = -1, i = 0;
  const ws = c => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
  const delim = c => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
  const push = (v, s) => {
    if (stack.length) stack[stack.length - 1].push(v);
    else { if (!args.length) argStart = s; args.push(v); }
  };
  while (i < b.length) {
    const c = b[i], s = i;
    if (ws(c) || c === 123 || c === 125) { i++; continue; }
    if (c === 37) { while (i < b.length && b[i] !== 10 && b[i] !== 13) i++; continue; }
    if (c === 40) {
      const out = [];
      let depth = 1;
      i++;
      while (i < b.length) {
        let ch = b[i++];
        if (ch === 92) {
          ch = b[i++];
          const esc = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 }[ch];
          if (esc !== undefined) out.push(esc);
          else if (ch >= 48 && ch <= 55) {
            let v = ch - 48;
            for (let k = 0; k < 2 && b[i] >= 48 && b[i] <= 55; k++) v = v * 8 + b[i++] - 48;
            out.push(v & 255);
          } else if (ch === 13) { if (b[i] === 10) i++; }
          else if (ch !== 10) out.push(ch);
        } else if (ch === 40) { depth++; out.push(ch); }
        else if (ch === 41) { if (--depth === 0) break; out.push(ch); }
        else out.push(ch);
      }
      push({ str: Uint8Array.from(out) }, s);
      continue;
    }
    if (c === 60 && b[i + 1] === 60) { i += 2; if (!stack.length && !args.length) argStart = s; stack.push([]); continue; }
    if (c === 62 && b[i + 1] === 62) { i += 2; const d = stack.pop() || []; push({ dict: d }, s); continue; }
    if (c === 60) {
      let hex = '';
      i++;
      while (i < b.length && b[i] !== 62) { const ch = String.fromCharCode(b[i++]); if (/[0-9a-f]/i.test(ch)) hex += ch; }
      i++;
      if (hex.length % 2) hex += '0';
      push({ str: Uint8Array.from(hex.match(/../g) || [], h => parseInt(h, 16)) }, s);
      continue;
    }
    if (c === 91) { i++; if (!stack.length && !args.length) argStart = s; stack.push([]); continue; }
    if (c === 93) { i++; const a = stack.pop() || []; push(a, s); continue; }
    if (c === 62 || c === 41) { i++; continue; }
    i++;
    while (i < b.length && !ws(b[i]) && !delim(b[i])) i++;
    const tok = String.fromCharCode(...b.subarray(c === 47 ? s + 1 : s, i));
    if (c === 47) { push({ name: tok, raw: String.fromCharCode(...b.subarray(s, i)) }, s); continue; }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) { push(+tok, s); continue; }
    if (tok === 'true' || tok === 'false' || tok === 'null') { push(tok, s); continue; }
    stack.length = 0;
    ops.push({ op: tok, args, start: args.length ? argStart : s, end: i });
    args = [];
    if (tok === 'BI') {
      while (i < b.length && !(b[i] === 73 && b[i + 1] === 68 && ws(b[i - 1]) && ws(b[i + 2]))) i++;
      i += 3;
      while (i < b.length && !(ws(b[i - 1]) && b[i] === 69 && b[i + 1] === 73 && (i + 2 >= b.length || ws(b[i + 2])))) i++;
      i += 2;
    }
  }
  return ops;
}

function pageContent(lib, index) {
  const c = lib.getPage(index).node.Contents();
  if (!c) return new Uint8Array();
  const streams = c instanceof PDFLib.PDFArray ? c.asArray().map(r => lib.context.lookup(r)) : [c];
  const parts = streams.map(s => PDFLib.decodePDFRawStream(s).decode());
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); out[o + p.length] = 10; o += p.length + 1; }
  return out;
}

function pdfjsShows(opl) {
  const O = pdfjsLib.OPS, shows = [], fonts = [];
  let font = null, depth = 0;
  opl.fnArray.forEach((fn, k) => {
    const a = opl.argsArray[k];
    if (fn === O.save || fn === O.paintFormXObjectBegin) fonts.push(font);
    if (fn === O.restore || fn === O.paintFormXObjectEnd) font = fonts.pop() ?? font;
    if (fn === O.paintFormXObjectBegin) depth++;
    if (fn === O.paintFormXObjectEnd) depth--;
    if (fn === O.setFont) font = a[0];
    if (fn === O.showText && depth === 0) shows.push({ font, glyphs: a[0] });
  });
  return shows;
}

const strBytes = (op, a) => op === 'TJ' ? (Array.isArray(a[0]) ? a[0] : []).reduce((n, x) => n + (x.str ? x.str.length : 0), 0) : ((op === '"' ? a[2] : a[0])?.str?.length ?? 0);

async function analyzePageText(pdfPage, lib, index, vp) {
  const content = pageContent(lib, index);
  const ops = lexContent(content);
  const shows = pdfjsShows(await pdfPage.getOperatorList({ annotationMode: pdfjsLib.AnnotationMode.DISABLE }));
  const textOps = ops.filter(o => TEXT_OPS.has(o.op));
  if (textOps.length !== shows.length) throw new Error(`found ${textOps.length} text operators but PDF.js decoded ${shows.length}`);

  const fonts = new Map();
  for (const key of new Set(shows.map(s => s.font))) {
    const face = await new Promise(r => pdfPage.commonObjs.get(key, r));
    fonts.set(key, { face, map: new Map(), bpc: face.composite ? undefined : 1 });
  }

  let st = { ctm: [1, 0, 0, 1, 0, 0], font: null, size: 0, Tc: 0, Tw: 0, Th: 1, TL: 0, Ts: 0 };
  const saved = [];
  let Tm = [1, 0, 0, 1, 0, 0], Tlm = Tm, t = 0;
  const runs = [];
  const td = (x, y) => { Tlm = mul([1, 0, 0, 1, x, y], Tlm); Tm = Tlm; };
  for (const o of ops) {
    const a = o.args;
    switch (o.op) {
      case 'q': saved.push({ ...st }); break;
      case 'Q': st = saved.pop() || st; break;
      case 'cm': st.ctm = mul(a, st.ctm); break;
      case 'BT': Tm = Tlm = [1, 0, 0, 1, 0, 0]; break;
      case 'Tf': st.font = a[0]?.raw; st.size = a[1]; break;
      case 'Tc': st.Tc = a[0]; break;
      case 'Tw': st.Tw = a[0]; break;
      case 'Tz': st.Th = a[0] / 100; break;
      case 'TL': st.TL = a[0]; break;
      case 'Ts': st.Ts = a[0]; break;
      case 'Td': td(a[0], a[1]); break;
      case 'TD': st.TL = -a[1]; td(a[0], a[1]); break;
      case 'Tm': Tm = Tlm = a.slice(0, 6); break;
      case 'T*': td(0, -st.TL); break;
    }
    if (!TEXT_OPS.has(o.op)) continue;
    if (o.op === '"') { st.Tw = a[0]; st.Tc = a[1]; }
    if (o.op === "'" || o.op === '"') td(0, -st.TL);
    const show = shows[t++], fi = fonts.get(show.font);
    const fm = fi.face.fontMatrix?.[0] ?? 0.001;
    let th = 0, text = '', nG = 0, nSp = 0;
    for (const g of show.glyphs) {
      if (typeof g === 'number') { th -= g; if (g < -180 && text && !text.endsWith(' ')) text += ' '; continue; }
      if (!g) continue;
      const w = (g.width || 0) * fm * 1000;
      th += w; nG++;
      if (g.isSpace) nSp++;
      text += g.unicode;
      if (g.unicode && !fi.map.has(g.unicode) && g.isInFont !== false) fi.map.set(g.unicode, { code: g.originalCharCode, w, space: g.isSpace });
    }
    const bytes = strBytes(o.op, a);
    if (!fi.face.composite && nG !== bytes) throw new Error('text operators and decoded glyphs are out of step');
    if (fi.face.composite && nG) {
      const bpc = bytes / nG;
      fi.bpc = fi.bpc === undefined && Number.isInteger(bpc) ? bpc : fi.bpc === bpc ? bpc : null;
    }
    if (st.size) th += 1000 * (st.Tc * nG + st.Tw * nSp) / st.size;
    const tx = th / 1000 * st.size * st.Th;
    const M = mul(Tm, st.ctm);
    const lo = st.Ts - 0.25 * st.size, hi = st.Ts + 0.9 * st.size;
    const pts = [[0, lo], [tx, lo], [0, hi], [tx, hi]].map(([x, y]) => vp.convertToViewportPoint(...apply(M, x, y)));
    const dir = [M[0], M[1]], dl = Math.hypot(...dir) || 1;
    runs.push({
      op: o.op, args: a, start: o.start, end: o.end, fontKey: show.font, fontName: st.font, size: st.size,
      Tc: st.Tc, Tw: st.Tw, th, text,
      origin: apply(M, 0, st.Ts), endPt: apply(M, tx, st.Ts), dir: [dir[0] / dl, dir[1] / dl],
      em: Math.abs(st.size) * Math.hypot(M[2], M[3]),
      box: [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))],
      locked: !!(fi.face.vertical || !st.size || !st.font),
    });
    Tm = mul([1, 0, 0, 1, tx, 0], Tm);
  }

  const groups = [];
  for (const r of runs) {
    if (r.locked) continue;
    const g = groups[groups.length - 1], last = g?.runs[g.runs.length - 1];
    let join = false, gap = 0;
    if (last && last.fontName === r.fontName && last.size === r.size && Math.abs(g.dir[0] * r.dir[1] - g.dir[1] * r.dir[0]) < 0.01) {
      const d = [r.origin[0] - g.origin[0], r.origin[1] - g.origin[1]];
      const perp = Math.abs(g.dir[0] * d[1] - g.dir[1] * d[0]);
      gap = g.dir[0] * (r.origin[0] - last.endPt[0]) + g.dir[1] * (r.origin[1] - last.endPt[1]);
      join = perp < 0.3 * g.em && gap > -0.5 * g.em && gap < 3 * g.em;
    }
    if (join) {
      if (gap > 0.15 * g.em && !g.text.endsWith(' ') && !r.text.startsWith(' ')) g.text += ' ';
      g.text += r.text;
      g.runs.push(r);
      g.box = [Math.min(g.box[0], r.box[0]), Math.min(g.box[1], r.box[1]), Math.max(g.box[2], r.box[2]), Math.max(g.box[3], r.box[3])];
    } else if (r.text.trim()) {
      groups.push({ runs: [r], text: r.text, box: r.box.slice(), origin: r.origin, dir: r.dir, em: r.em, fontKey: r.fontKey, face: fonts.get(r.fontKey).face });
    }
  }
  groups.forEach(g => { g.text = g.text.trim(); });
  return { content, fonts, groups };
}

function standardFontFor(face) {
  const n = `${face.name || ''} ${face.fallbackName || ''}`;
  const bold = face.bold || face.black || /bold|black|heavy|semibold/i.test(n), italic = face.italic || /italic|oblique/i.test(n);
  const fam = /courier|mono|consol/i.test(n) ? 'Courier' : /times|serif(?!-)|roman|georgia|garamond|cambria|book|minion/i.test(n) && !/sans/i.test(n) ? 'Times' : 'Helvetica';
  if (fam === 'Times') return 'Times' + (bold && italic ? 'RomanBoldItalic' : bold ? 'RomanBold' : italic ? 'RomanItalic' : 'Roman');
  return fam + (bold && italic ? 'BoldOblique' : bold ? 'Bold' : italic ? 'Oblique' : '');
}

const cssFontFor = face => {
  const sf = standardFontFor(face);
  return { fontFamily: sf.startsWith('Times') ? 'Times, serif' : sf.startsWith('Courier') ? 'Courier, monospace' : 'Helvetica, Arial, sans-serif', fontWeight: /Bold/.test(sf) ? 'bold' : 'normal', fontStyle: /Italic|Oblique/.test(sf) ? 'italic' : 'normal' };
};

// Each replacement keeps its operator's original advance, so text drawn after it on the line does not move.
async function rewritePageText(info, out, outPage, fontCache) {
  const reps = [], pageFonts = new Map();

  async function encodeLine(text, r, fi) {
    if (fi.bpc && [...text].every(c => c === ' ' || fi.map.has(c))) {
      const parts = [];
      let hex = '', th = 0, nG = 0, nSp = 0;
      for (const c of text) {
        const m = fi.map.get(c);
        if (m) { hex += m.code.toString(16).padStart(fi.bpc * 2, '0'); th += m.w; nG++; if (m.space) nSp++; continue; }
        // subset fonts often have no space glyph, so advance with a TJ offset instead
        if (hex) parts.push(`<${hex}>`);
        hex = '';
        parts.push(-250); th += 250;
      }
      if (hex) parts.push(`<${hex}>`);
      th += 1000 * (r.Tc * nG + r.Tw * nSp) / r.size;
      return `[${parts.join(' ')} ${fmt(th - r.th)}] TJ`;
    }
    const std = standardFontFor(fi.face);
    if (!fontCache.has(std)) fontCache.set(std, await out.embedFont(PDFLib.StandardFonts[std]));
    const f = fontCache.get(std);
    if (!pageFonts.has(std)) pageFonts.set(std, outPage.node.newFontDictionary('PEd', f.ref).toString());
    const spaces = [...text].filter(c => c === ' ').length;
    const th = f.widthOfTextAtSize(text, 1000) + 1000 * (r.Tc * [...text].length + r.Tw * spaces) / r.size;
    return `${pageFonts.get(std)} ${fmt(r.size)} Tf [${f.encodeText(text).toString()} ${fmt(th - r.th)}] TJ ${r.fontName} ${fmt(r.size)} Tf`;
  }

  for (const g of info.groups) {
    if (g.newText === undefined || g.newText === g.text) continue;
    for (const [k, r] of g.runs.entries()) {
      const pre = r.op === "'" ? 'T* ' : r.op === '"' ? `${fmt(r.args[0])} Tw ${fmt(r.args[1])} Tc T* ` : '';
      reps.push({ start: r.start, end: r.end, text: pre + (k === 0 ? await encodeLine(g.newText, r, info.fonts.get(r.fontKey)) : `[${fmt(-r.th)}] TJ`) });
    }
  }

  reps.sort((a, b) => a.start - b.start);
  const enc = new TextEncoder(), chunks = [];
  let at = 0;
  for (const rep of reps) { chunks.push(info.content.subarray(at, rep.start), enc.encode(rep.text)); at = rep.end; }
  chunks.push(info.content.subarray(at));
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { bytes.set(c, o); o += c.length; }
  return bytes;
}
