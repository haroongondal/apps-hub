import { MIN_RANGE_S, moveEdge, snapTenth } from './timeline.ts';
import type { MediaInfo } from './types.ts';

// width and height are the DISPLAY size (rotation already applied); durationS is floored to a tenth.
export interface Source { uri: string; name: string; durationS: number; width: number; height: number; fps: number; hasAudio: boolean }
export interface Clip { id: string; source: Source; inS: number; outS: number; volume: number }
export interface AudioSource { uri: string; name: string; durationS: number }
// startS is the place on the video's timeline; inS and outS are times in the audio file.
export interface Music { id: string; source: AudioSource; inS: number; outS: number; startS: number; volume: number }
export interface Project { name: string; clips: Clip[]; music: Music[] }

export const MAX_CLIPS = 20;
export const MAX_TOTAL_S = 600;
export const VOLUME_STEPS = [0, 0.5, 1, 1.5] as const;
export const MAX_VOLUME = 1.5;
export const MAX_MUSIC = 5;
const EPS = 1e-6;

const floorTenth = (s: number) => Math.floor(s * 10 + EPS) / 10;
const hasId = (p: Project, id: string) => p.clips.some(c => c.id === id);

export const emptyProject = (name = 'My video'): Project => ({ name, clips: [], music: [] });

export function sourceFrom(info: MediaInfo): Source | undefined {
  const video = info.tracks.find(t => t.kind === 'video');
  const durationS = floorTenth(info.durationS);
  if (!video?.width || !video.height || !(durationS >= MIN_RANGE_S)) return undefined;
  const turned = video.rotation === 90 || video.rotation === 270;
  return {
    uri: info.id, name: info.name, durationS,
    width: turned ? video.height : video.width, height: turned ? video.width : video.height,
    fps: video.fps ?? 30, hasAudio: info.tracks.some(t => t.kind === 'audio'),
  };
}

export function audioSourceFrom(info: MediaInfo): AudioSource | undefined {
  const durationS = floorTenth(info.durationS);
  if (!info.tracks.some(t => t.kind === 'audio') || !(durationS >= MIN_RANGE_S)) return undefined;
  return { uri: info.id, name: info.name, durationS };
}

export const clipLengthS = (c: Clip): number => snapTenth(c.outS - c.inS);
export const totalS = (p: Project): number => snapTenth(p.clips.reduce((sum, c) => sum + clipLengthS(c), 0));

export function clipStarts(p: Project): number[] {
  let at = 0;
  return p.clips.map(c => { const start = at; at = snapTenth(at + clipLengthS(c)); return start; });
}

export function clipSpans(p: Project, pxPerS: number): { id: string; leftPx: number; widthPx: number }[] {
  const starts = clipStarts(p);
  return p.clips.map((c, i) => ({ id: c.id, leftPx: starts[i] * pxPerS, widthPx: Math.max(1, clipLengthS(c) * pxPerS) }));
}

export function locate(p: Project, timelineS: number): { index: number; offsetS: number } | undefined {
  const total = totalS(p);
  if (!p.clips.length || !(timelineS >= 0) || timelineS > total + EPS) return undefined;
  const starts = clipStarts(p);
  const index = timelineS >= total - EPS ? p.clips.length - 1 : starts.filter(s => s <= timelineS + EPS).length - 1;
  return { index, offsetS: Math.min(timelineS - starts[index], clipLengthS(p.clips[index])) };
}

export function addClip(p: Project, s: Source, id: string): Project {
  if (hasId(p, id)) return p;
  return { ...p, clips: [...p.clips, { id, source: s, inS: 0, outS: floorTenth(s.durationS), volume: 1 }] };
}

export function splitAt(p: Project, timelineS: number, newId: string): Project {
  const at = locate(p, timelineS);
  if (!at || hasId(p, newId)) return p;
  const c = p.clips[at.index];
  if (at.offsetS < MIN_RANGE_S - EPS || clipLengthS(c) - at.offsetS < MIN_RANGE_S - EPS) return p;
  const cut = snapTenth(c.inS + at.offsetS);
  const clips = [...p.clips];
  clips.splice(at.index, 1, { ...c, outS: cut }, { ...c, id: newId, inS: cut });
  return { ...p, clips };
}

export function trimClip(p: Project, id: string, edge: 'start' | 'end', toSourceS: number): Project {
  return {
    ...p,
    clips: p.clips.map(c => {
      if (c.id !== id) return c;
      const r = moveEdge({ startS: c.inS, endS: c.outS }, edge, toSourceS, floorTenth(c.source.durationS));
      return { ...c, inS: r.startS, outS: r.endS };
    }),
  };
}

// Within a tenth of the clip's ends (a join, the very end) a trim would leave a sliver that can never grow back.
export function trimAt(p: Project, timelineS: number, edge: 'start' | 'end'): Project {
  const at = locate(p, timelineS);
  if (!at) return p;
  const c = p.clips[at.index];
  if (at.offsetS < MIN_RANGE_S - EPS || clipLengthS(c) - at.offsetS < MIN_RANGE_S - EPS) return p;
  return trimClip(p, c.id, edge, c.inS + at.offsetS);
}

export function moveClip(p: Project, id: string, by: -1 | 1): Project {
  const i = p.clips.findIndex(c => c.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= p.clips.length) return p;
  const clips = [...p.clips];
  [clips[i], clips[j]] = [clips[j], clips[i]];
  return { ...p, clips };
}

export const deleteClip = (p: Project, id: string): Project => ({ ...p, clips: p.clips.filter(c => c.id !== id) });

const okVolume = (v: number) => Number.isFinite(v) && v >= 0 && v <= MAX_VOLUME;

export function setClipVolume(p: Project, id: string, volume: number): Project {
  if (!okVolume(volume)) return p;
  return { ...p, clips: p.clips.map(c => (c.id === id ? { ...c, volume } : c)) };
}

export const musicLengthS = (m: Music): number => snapTenth(m.outS - m.inS);
export const musicEndS = (m: Music): number => snapTenth(m.startS + musicLengthS(m));

const others = (p: Project, id: string) => p.music.filter(m => m.id !== id);
// The free stretch of the timeline around a piece: from the end of the piece before it to the start of the one after.
const prevEnd = (music: Music[], atS: number) => Math.max(0, ...music.filter(m => musicEndS(m) <= atS + EPS).map(musicEndS));
const nextStart = (music: Music[], atS: number) => Math.min(Infinity, ...music.filter(m => m.startS >= atS - EPS).map(m => m.startS));
const overlaps = (music: Music[]) => {
  const sorted = [...music].sort((a, b) => a.startS - b.startS);
  return sorted.some((m, i) => i > 0 && m.startS < musicEndS(sorted[i - 1]) - EPS);
};
const withPiece = (p: Project, id: string, f: (m: Music) => Music): Project =>
  ({ ...p, music: p.music.map(m => (m.id === id ? f(m) : m)) });

export function addMusic(p: Project, s: AudioSource, id: string, atS: number): Project {
  if (p.music.length >= MAX_MUSIC || p.music.some(m => m.id === id) || !(atS >= 0)) return p;
  let startS = snapTenth(atS);
  for (let covering = true; covering;) {
    const c = p.music.find(m => m.startS <= startS + EPS && startS < musicEndS(m) - EPS);
    covering = !!c;
    if (c) startS = musicEndS(c);
  }
  const room = Math.min(totalS(p), nextStart(p.music, startS)) - startS;
  const outS = floorTenth(Math.min(s.durationS, room));
  if (outS < MIN_RANGE_S - EPS) return p;
  return { ...p, music: [...p.music, { id, source: s, inS: 0, outS, startS, volume: 1 }] };
}

// A start trim moves startS by the same amount, so the sound under the end stays where it was.
export function trimMusic(p: Project, id: string, edge: 'start' | 'end', toSourceS: number): Project {
  return withPiece(p, id, m => {
    const rest = others(p, id);
    const to = edge === 'start'
      ? Math.max(toSourceS, m.inS - (m.startS - prevEnd(rest, m.startS)))
      : Math.min(toSourceS, m.outS + (nextStart(rest, musicEndS(m)) - musicEndS(m)));
    const r = moveEdge({ startS: m.inS, endS: m.outS }, edge, to, floorTenth(m.source.durationS));
    return { ...m, inS: r.startS, outS: r.endS, startS: snapTenth(m.startS + r.startS - m.inS) };
  });
}

export function moveMusic(p: Project, id: string, toTimelineS: number): Project {
  const m = p.music.find(x => x.id === id);
  if (!m || !(toTimelineS >= 0)) return p;
  const moved = { ...m, startS: snapTenth(toTimelineS) };
  if (musicEndS(moved) > totalS(p) + EPS || overlaps([...others(p, id), moved])) return p;
  return withPiece(p, id, () => moved);
}

export function setMusicVolume(p: Project, id: string, volume: number): Project {
  return okVolume(volume) ? withPiece(p, id, m => ({ ...m, volume })) : p;
}

export const deleteMusic = (p: Project, id: string): Project => ({ ...p, music: others(p, id) });

export function projectProblem(p: Project): string | undefined {
  if (!p.clips.length) return 'Add a clip first.';
  if (p.clips.length > MAX_CLIPS) return `A video can have up to ${MAX_CLIPS} clips.`;
  if (totalS(p) > MAX_TOTAL_S + EPS) return `A video can be up to ${MAX_TOTAL_S / 60} minutes long.`;
  if (p.music.length > MAX_MUSIC) return `A video can have up to ${MAX_MUSIC} pieces of music.`;
  if (overlaps(p.music)) return 'Music pieces cannot overlap.';
  return undefined;
}

// Trust boundary: the draft file is read back from disk, so every field is checked and the project rebuilt.
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPos = (v: unknown): v is number => isNum(v) && v > 0;

function sourceOf(v: unknown): Source | undefined {
  if (!isObj(v)) return undefined;
  const { uri, name, durationS, width, height, fps, hasAudio } = v;
  if (!isStr(uri) || !isStr(name) || !isPos(durationS) || !isPos(width) || !isPos(height) || !isPos(fps) || typeof hasAudio !== 'boolean') return undefined;
  return { uri, name, durationS, width, height, fps, hasAudio };
}

const isVolume = (v: unknown): v is number => isNum(v) && okVolume(v);
const goodSpan = (inS: number, outS: number, durationS: number) =>
  inS >= 0 && outS - inS >= MIN_RANGE_S - EPS && outS <= durationS + EPS;

function clipOf(v: unknown): Clip | undefined {
  if (!isObj(v)) return undefined;
  const { id, inS, outS } = v;
  const volume = v.volume ?? 1; // stage 2 drafts have no volume
  const source = sourceOf(v.source);
  if (!source || !isStr(id) || !isNum(inS) || !isNum(outS) || !isVolume(volume)) return undefined;
  if (!goodSpan(inS, outS, source.durationS)) return undefined;
  return { id, source, inS, outS, volume };
}

function musicOf(v: unknown): Music | undefined {
  if (!isObj(v) || !isObj(v.source)) return undefined;
  const { id, inS, outS, startS, volume } = v;
  const { uri, name, durationS } = v.source;
  if (!isStr(id) || !isStr(uri) || !isStr(name) || !isPos(durationS)) return undefined;
  if (!isNum(inS) || !isNum(outS) || !isNum(startS) || startS < 0 || !isVolume(volume)) return undefined;
  if (!goodSpan(inS, outS, durationS)) return undefined;
  return { id, source: { uri, name, durationS }, inS, outS, startS, volume };
}

const uniqueIds = (xs: { id: string }[]) => new Set(xs.map(x => x.id)).size === xs.length;

export function parseDraft(text: string): Project | undefined {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return undefined; }
  if (!isObj(v) || !isStr(v.name) || !Array.isArray(v.clips)) return undefined;
  const rawMusic = v.music ?? []; // stage 2 drafts have no music
  if (!Array.isArray(rawMusic)) return undefined;
  const clips = v.clips.map(clipOf);
  const music = rawMusic.map(musicOf);
  if (clips.some(c => !c) || music.some(m => !m)) return undefined;
  const ok = clips as Clip[];
  const okMusic = music as Music[];
  if (!uniqueIds(ok) || !uniqueIds(okMusic) || overlaps(okMusic)) return undefined;
  return { name: v.name, clips: ok, music: okMusic };
}
