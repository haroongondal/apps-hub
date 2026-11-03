import type { Encoder, MediaInfo, Planned, Rung, SizePlan, Track } from './types.ts';

export const LADDER: readonly Rung[] = [
  { shortSide: 1080, fps: 30 }, { shortSide: 720, fps: 30 }, { shortSide: 540, fps: 30 },
  { shortSide: 480, fps: 30 }, { shortSide: 360, fps: 30 }, { shortSide: 360, fps: 24 },
  { shortSide: 240, fps: 24 },
];

// shortcut: floors are assumed (RESEARCH §6.3), tune them on the owner's phone in Phase 1 step 7.
export const FLOOR: Record<Encoder, number> = { 'hw-h264': 0.05, 'hw-hevc': 0.035, x264: 0.04 };

export interface SizeOptions { correction?: number; maxFps?: number }
export interface Walk { rung: Rung; width: number; height: number; bpp: number; fits: boolean }

export function walkLadder(src: { width: number; height: number; fps: number }, videoBps: number, encoder: Encoder): Walk {
  const shortSrc = Math.min(src.width, src.height);
  const fitting = LADDER.filter(r => r.shortSide <= shortSrc);
  const rungs = fitting.length ? fitting : [LADDER[LADDER.length - 1]];
  const walks = rungs.map((r): Walk => {
    // even, because yuv420p needs even sides; a 1079-px source would otherwise plan an odd height
    const shortSide = 2 * Math.floor(Math.min(r.shortSide, shortSrc) / 2);
    const fps = Math.min(r.fps, src.fps);
    const { width, height } = dimsFor(src.width, src.height, shortSide);
    const bpp = videoBps / (width * height * fps);
    return { rung: { shortSide, fps }, width, height, bpp, fits: bpp >= FLOOR[encoder] };
  });
  return walks.find(w => w.fits) ?? walks[walks.length - 1];
}

export function planSize(info: MediaInfo, targetBytes: number, encoder: Encoder, opts: SizeOptions = {}): Planned<SizePlan> {
  const video = info.tracks.find(t => t.kind === 'video');
  if (!video) return { ok: false, reason: 'no-video' };
  if (!(info.durationS > 0) || !video.width || !video.height) {
    return { ok: false, reason: 'invalid', detail: "The file's size or length couldn't be read." };
  }
  const maxFps = opts.maxFps ?? 30;
  const margin = encoder === 'x264' ? 0.97 : 0.90;
  const overheadBytes = Math.round(65_536 + 0.01 * targetBytes);
  const totalBps = (targetBytes * margin - overheadBytes) * 8 / info.durationS;
  const audio = audioFor(info.tracks, totalBps);
  const fpsCap = Math.min(video.fps ?? maxFps, maxFps);
  const videoBps = Math.round((totalBps - audio.bps) / (opts.correction ?? 1));
  const walk = walkLadder({ width: video.width, height: video.height, fps: fpsCap }, videoBps, encoder);
  if (!walk.fits && walk.bpp < FLOOR[encoder] / 2) {
    const lowestFloorBps = FLOOR[encoder] * walk.width * walk.height * walk.rung.fps / 2 + 48_000;
    const maxDurationS = Math.floor((targetBytes * margin - overheadBytes) * 8 / lowestFloorBps);
    return { ok: false, reason: 'too-long', maxDurationS };
  }
  const plannedVideoBytes = Math.round(videoBps * info.durationS / 8);
  const plannedBytes = Math.round(plannedVideoBytes + audio.bps * info.durationS / 8 + overheadBytes);
  return {
    ok: true,
    plan: {
      tool: 'size', targetBytes, encoder, rung: walk.rung, width: walk.width, height: walk.height,
      videoBps, audio: audio.audio, overheadBytes, plannedVideoBytes, plannedBytes, attempt: 1, margin, fpsCap,
    },
  };
}

function audioFor(tracks: Track[], totalBps: number): { audio: SizePlan['audio']; bps: number } {
  const track = tracks.find(t => t.kind === 'audio');
  if (!track) return { audio: { mode: 'none' }, bps: 0 };
  const tier = totalBps >= 1_000_000 ? 128_000 : totalBps >= 500_000 ? 96_000 : totalBps >= 250_000 ? 64_000 : 48_000;
  if (track.codec === 'aac' && track.bitrate && track.bitrate <= tier) return { audio: { mode: 'copy' }, bps: track.bitrate };
  return { audio: { mode: 'aac', bps: tier }, bps: tier };
}

// Rounded to even, not to 16: the 30-min refusal figure (1,297 s) is computed with 426 px, not 432.
export function dimsFor(w: number, h: number, shortSide: number): { width: number; height: number } {
  const long = 2 * Math.round(shortSide * Math.max(w, h) / Math.min(w, h) / 2);
  return w >= h ? { width: long, height: shortSide } : { width: shortSide, height: long };
}
