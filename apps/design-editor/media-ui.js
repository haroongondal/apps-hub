const api = window.native.media;
const $ = id => document.getElementById(id);
const $$ = sel => [...document.querySelectorAll(sel)];
const MB = 1e6;
const TOOL_LABELS = { size: 'Compress to size', quality: 'Compress by quality', clip: 'Clip', audio: 'Extract audio', gif: 'Make a GIF', convert: 'Convert', frame: 'Still frame' };
const STATE_TEXT = { queued: 'Queued', running: 'Working', done: 'Done', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted', paused: 'Paused' };
const state = { tool: 'size', files: [], selected: new Set(), folder: null, jobs: [], destinations: [], specs: new Map() };
let planTimer = 0;
let thumbToken = 0;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, action) {
  const b = el('button', 'ui-btn ui-btn--ghost', text);
  b.onclick = () => action().catch(fail);
  return b;
}

function option(value, text) {
  const o = el('option', '', text);
  o.value = value;
  return o;
}

function remembered(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function remember(key, value) {
  try { localStorage.setItem(key, value); } catch { /* the choice is kept for this session only */ }
}

function fmt(seconds) {
  const m = Math.floor(seconds / 60);
  return `${m}:${(seconds - m * 60).toFixed(1).padStart(4, '0')}`;
}

function parseTime(text) {
  if (!String(text).trim()) return NaN;
  const parts = String(text).trim().split(':');
  if (parts.length > 2) return NaN;
  return parts.length === 1 ? Number(text) : parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

function fail(err) {
  setPlan(String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);
}

function setPlan(text, isError = false) {
  const p = $('plan');
  p.textContent = text;
  if (isError) p.dataset.error = '';
  else delete p.dataset.error;
}

function selectedFiles() {
  return state.files.filter(f => state.selected.has(f.id));
}

function describe(f) {
  const v = f.tracks.find(t => t.kind === 'video');
  const audio = f.tracks.filter(t => t.kind === 'audio').length;
  return [
    v ? `${v.width}×${v.height}, ${v.fps ?? '?'} fps, ${v.codec}` : 'audio only',
    fmt(f.durationS),
    `${(f.bytes / MB).toFixed(1)} MB`,
    `${audio} audio ${audio === 1 ? 'track' : 'tracks'}`,
  ].join(' · ');
}

function selectTool(tool) {
  state.tool = tool;
  $$('.tools button').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
  $$('.options section').forEach(s => { s.hidden = s.dataset.tool !== tool; });
  renderTracks();
  renderThumbs();
  schedulePlan();
}

function setDefaults(f) {
  $('clipStart').value = fmt(0);
  $('clipEnd').value = fmt(f.durationS);
  $('gifStart').value = fmt(0);
  $('gifEnd').value = fmt(Math.min(f.durationS, 10));
  $('frameTime').value = fmt(0);
}

function renderFiles() {
  const list = $('files');
  list.replaceChildren();
  for (const f of state.files) {
    const label = el('label');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = state.selected.has(f.id);
    box.onchange = () => {
      if (box.checked) state.selected.add(f.id);
      else state.selected.delete(f.id);
      renderTracks();
      renderThumbs();
      schedulePlan();
    };
    label.append(box, el('span', '', `${f.name} · ${describe(f)}`));
    const li = el('li');
    li.append(label);
    list.append(li);
  }
  $('fileCount').textContent = state.files.length ? `${state.selected.size} of ${state.files.length} selected` : '';
  updateStart();
}

function renderTracks() {
  const box = $('tracks');
  box.querySelectorAll('label').forEach(l => l.remove());
  const first = selectedFiles()[0];
  const audio = first ? first.tracks.filter(t => t.kind === 'audio') : [];
  audio.forEach((t, i) => {
    const input = el('input', 'track');
    input.type = 'checkbox';
    input.checked = true;
    input.value = String(t.index);
    input.onchange = schedulePlan;
    const lang = t.language && t.language !== 'und' ? ` · ${t.language}` : '';
    const label = el('label');
    label.append(input, ` Audio ${i + 1}${lang} · ${t.codec}`);
    box.append(label);
  });
}

// The player plays through the mediain scheme: the renderer sends an input id, and the main process owns the path (PRD AC-11).
$('clipPreview').onclick = () => {
  const f = selectedFiles()[0];
  if (!f) return;
  $('clipVideo').src = `mediain://${f.id}/`;
  $('clipVideo').hidden = false;
};

async function renderThumbs() {
  const box = $('thumbs');
  const token = ++thumbToken;
  box.replaceChildren();
  $('clipVideo').pause();
  $('clipVideo').hidden = true;
  const f = selectedFiles()[0];
  if (state.tool !== 'clip' || !f || !f.tracks.some(t => t.kind === 'video')) return;
  const times = Array.from({ length: 10 }, (_, i) => f.durationS * (i + 0.5) / 10);
  try {
    const frames = await api.thumbs(f.id, times);
    if (token !== thumbToken) return;
    for (const src of frames) {
      const img = el('img');
      img.src = src;
      img.alt = '';
      box.append(img);
    }
  } catch (err) {
    fail(err);
  }
}

function currentSpecs() {
  const files = selectedFiles();
  if (state.tool === 'audio') {
    const tracks = $$('#tracks .track:checked').map(i => Number(i.value));
    return files.flatMap(f => tracks.map(trackIndex => ({ tool: 'audio', inputId: f.id, trackIndex })));
  }
  return files.map(buildSpec);
}

function buildSpec(f) {
  switch (state.tool) {
    case 'size': {
      const preset = $('sizePreset').value;
      const targetBytes = preset === 'custom'
        ? Math.round(Number($('sizeCustom').value) * MB)
        : state.destinations.find(d => d.id === preset).bytes;
      return { tool: 'size', inputId: f.id, targetBytes, encoder: $('sizeCodec').value === 'hevc' ? 'hw-hevc' : 'x264' };
    }
    case 'quality':
      return { tool: 'quality', inputId: f.id, preset: $('qualityPreset').value };
    case 'clip':
      return {
        tool: 'clip', inputId: f.id, startS: parseTime($('clipStart').value), endS: parseTime($('clipEnd').value), mode: $('clipMode').value,
      };
    case 'gif': {
      const spec = {
        tool: 'gif', inputId: f.id, startS: parseTime($('gifStart').value), endS: parseTime($('gifEnd').value),
        width: Number($('gifWidth').value), fps: Number($('gifFps').value),
      };
      if ($('gifFit').checked) spec.targetBytes = Math.round(Number($('gifFitMb').value) * MB);
      return spec;
    }
    case 'convert':
      return {
        tool: 'convert', inputId: f.id, target: $('convertTarget').value, videoCodec: $('convertCodec').value, muted: $('convertMute').checked,
      };
    case 'frame':
      return { tool: 'frame', inputId: f.id, timeS: parseTime($('frameTime').value), format: $('frameFormat').value };
    default:
      throw new Error("This job type isn't supported yet.");
  }
}

function refusalText(r) {
  if (r.detail) return r.detail;
  if (r.reason === 'too-long') return `This video can hold about ${Math.floor(r.maxDurationS / 60)} minutes at the lowest quality.`;
  return "Couldn't plan this job.";
}

function describePlan(p) {
  switch (p.tool) {
    case 'size':
      return `${p.width}×${p.height}, ${p.rung.fps} fps, ${p.encoder === 'hw-hevc' ? 'HEVC' : 'H.264'}, about ${(p.plannedBytes / MB).toFixed(1)} MB`;
    case 'quality':
      return `${p.width}×${p.height}, ${p.rung.fps} fps, H.264`;
    case 'clip':
      return p.mode === 'copy'
        ? `Starts at ${fmt(p.keyframeS)}, the nearest keyframe before ${fmt(p.startS)}. Ends at ${fmt(p.endS)}.`
        : `Cuts at ${fmt(p.startS)} and ends at ${fmt(p.endS)}, re-encoding the video.`;
    case 'audio':
      return `Saves this track as .${p.ext}${p.mode === 'copy' ? ', copied without re-encoding' : ''}`;
    case 'gif':
      return `${p.width} px wide, ${p.fps} fps${p.targetBytes ? `, fit under ${(p.targetBytes / MB).toFixed(0)} MB` : ''}`;
    case 'convert': {
      const sound = p.audio ? '' : ', without sound';
      return p.mode === 'remux' ? `Saves as .${p.ext} without re-encoding${sound}` : `Re-encodes to .${p.ext}${sound}`;
    }
    case 'frame':
      return `One ${p.format === 'jpg' ? 'JPEG' : 'PNG'} frame at ${fmt(p.timeS)}`;
    default:
      return 'Ready';
  }
}

function schedulePlan() {
  clearTimeout(planTimer);
  planTimer = setTimeout(updatePlan, 150);
  syncFields();
  updateStart();
}

async function updatePlan() {
  const specs = currentSpecs();
  if (!specs.length) {
    setPlan(state.files.length ? 'Select a file to see the plan.' : 'Add a file to see the plan.');
    return;
  }
  try {
    const r = await api.plan(specs[0]);
    if (!r.ok) {
      setPlan(refusalText(r), true);
      return;
    }
    const more = specs.length > 1 ? `, and ${specs.length - 1} more` : '';
    setPlan(describePlan(r.plan) + more);
  } catch (err) {
    fail(err);
  }
}

function syncFields() {
  $('sizeCustomField').hidden = $('sizePreset').value !== 'custom';
  $('gifFitField').hidden = !$('gifFit').checked;
  $('gifWarn').hidden = !(parseTime($('gifEnd').value) - parseTime($('gifStart').value) > 15);
}

function updateStart() {
  $('start').disabled = !(state.folder && currentSpecs().length);
}

const JOB_LINE = job => {
  const parts = [TOOL_LABELS[job.plan.tool], STATE_TEXT[job.state] ?? job.state];
  if (job.state === 'running' && job.attempt > 1) parts.push(`Try ${job.attempt} of 3`);
  if (job.state === 'done') parts.push(job.outputs[0].name);
  return parts.join(' · ');
};

function renderJobs() {
  const list = $('jobs');
  list.replaceChildren();
  for (const job of state.jobs) {
    const li = el('li');
    li.append(el('div', 'job-name', job.inputName), el('div', 'job-state', JOB_LINE(job)));
    if (job.state === 'running' || job.state === 'queued') {
      const bar = el('progress');
      bar.max = 1;
      bar.value = job.progress;
      li.append(bar);
    }
    if (job.error) li.append(el('div', 'job-state', job.error));
    const actions = el('div', 'job-actions');
    if (job.state === 'queued' || job.state === 'running') actions.append(button('Cancel', () => api.cancel(job.id)));
    if (job.state === 'failed' || job.state === 'cancelled') actions.append(button('Try again', () => retry(job.id)));
    if (job.state === 'done') {
      actions.append(button('Show in Finder', () => api.reveal(job.id)), button('Open', () => api.open(job.id)));
    }
    li.append(actions);
    list.append(li);
  }
}

async function retry(jobId) {
  const item = state.specs.get(jobId);
  if (!item) return;
  const [id] = await api.enqueue([item]);
  state.specs.set(id, item);
}

async function init() {
  const status = await api.status();
  $('ffmpegNotice').hidden = status.ready;
  state.destinations = status.destinations;
  const presets = $('sizePreset');
  for (const d of status.destinations) presets.append(option(d.id, `${d.label}, ${d.bytes / MB} MB`));
  presets.append(option('custom', 'Custom size'));
  presets.value = 'discord';
  $('sizeCodec').value = remembered('media.sizeCodec', 'h264');
  $('convertCodec').value = remembered('media.convertCodec', 'h264');
  api.onEvent(e => {
    if (e.type !== 'queue') return;
    state.jobs = e.jobs;
    renderJobs();
  });
  state.jobs = await api.queue();
  renderJobs();
  selectTool('size');
}

$$('.tools button').forEach(b => { b.onclick = () => selectTool(b.dataset.tool); });
$('addFiles').onclick = async () => {
  try {
    const picked = await api.pick();
    if (!picked.length) return;
    state.files.push(...picked);
    picked.forEach(f => state.selected.add(f.id));
    setDefaults(picked[0]);
    renderFiles();
    renderTracks();
    renderThumbs();
    schedulePlan();
  } catch (err) {
    fail(err);
  }
};
$('pickFolder').onclick = async () => {
  try {
    const folder = await api.pickFolder();
    if (!folder) return;
    state.folder = folder;
    $('folderName').textContent = folder.name;
    updateStart();
  } catch (err) {
    fail(err);
  }
};
$('start').onclick = async () => {
  const items = currentSpecs().map(spec => ({ folderId: state.folder.id, spec }));
  try {
    const ids = await api.enqueue(items);
    ids.forEach((id, i) => state.specs.set(id, items[i]));
    setPlan(`Queued ${ids.length} ${ids.length === 1 ? 'job' : 'jobs'}.`);
  } catch (err) {
    fail(err);
  }
};
$('cancelAll').onclick = () => api.cancel('all').catch(fail);
$('sizeCodec').onchange = e => remember('media.sizeCodec', e.target.value);
$('convertCodec').onchange = e => remember('media.convertCodec', e.target.value);
$('gifFit').onchange = syncFields;
document.querySelector('.options').addEventListener('input', schedulePlan);
document.querySelector('.options').addEventListener('change', schedulePlan);

init().catch(fail);
