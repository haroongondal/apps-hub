import { MIN_RANGE_S, moveEdge, snapTenth } from './timeline.ts';
import type { MediaInfo } from './types.ts';

// width and height are the DISPLAY size (rotation already applied); durationS is floored to a tenth.
export interface Source { uri: string; name: string; durationS: number; width: number; height: number; fps: number; hasAudio: boolean }
export interface Clip { id: string; source: Source; inS: number; outS: number }
export interface Project { name: string; clips: Clip[] }

export const MAX_CLIPS = 20;
export const MAX_TOTAL_S = 600;
const EPS = 1e-6;

const floorTenth = (s: number) => Math.floor(s * 10 + EPS) / 10;
const hasId = (p: Project, id: string) => p.clips.some(c => c.id === id);

export const emptyProject = (name = 'My video'): Project => ({ name, clips: [] });

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
  return { ...p, clips: [...p.clips, { id, source: s, inS: 0, outS: floorTenth(s.durationS) }] };
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

export function moveClip(p: Project, id: string, by: -1 | 1): Project {
  const i = p.clips.findIndex(c => c.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= p.clips.length) return p;
  const clips = [...p.clips];
  [clips[i], clips[j]] = [clips[j], clips[i]];
  return { ...p, clips };
}

export const deleteClip = (p: Project, id: string): Project => ({ ...p, clips: p.clips.filter(c => c.id !== id) });

export function projectProblem(p: Project): string | undefined {
  if (!p.clips.length) return 'Add a clip first.';
  if (p.clips.length > MAX_CLIPS) return `A video can have up to ${MAX_CLIPS} clips.`;
  if (totalS(p) > MAX_TOTAL_S + EPS) return `A video can be up to ${MAX_TOTAL_S / 60} minutes long.`;
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

function clipOf(v: unknown): Clip | undefined {
  if (!isObj(v)) return undefined;
  const { id, inS, outS } = v;
  const source = sourceOf(v.source);
  if (!source || !isStr(id) || !isNum(inS) || !isNum(outS)) return undefined;
  if (inS < 0 || outS - inS < MIN_RANGE_S - EPS || outS > source.durationS + EPS) return undefined;
  return { id, source, inS, outS };
}

export function parseDraft(text: string): Project | undefined {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return undefined; }
  if (!isObj(v) || !isStr(v.name) || !Array.isArray(v.clips)) return undefined;
  const clips = v.clips.map(clipOf);
  if (clips.some(c => !c)) return undefined;
  const ok = clips as Clip[];
  if (new Set(ok.map(c => c.id)).size !== ok.length) return undefined;
  return { name: v.name, clips: ok };
}
