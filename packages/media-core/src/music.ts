import type { MediaInfo, MusicPlan, Planned } from './types.ts';

// Mix needs the clip's own sound; a silent clip gets the song alone even when Mix was picked.
export function planMusic(video: MediaInfo, song: MediaInfo, mode: 'mix' | 'replace', gainDb: number): Planned<MusicPlan> {
  const v = video.tracks.find(t => t.kind === 'video');
  if (!v) return { ok: false, reason: 'no-video' };
  if (!song.tracks.some(t => t.kind === 'audio')) return { ok: false, reason: 'invalid', detail: 'The song file has no audio.' };
  const hasSound = video.tracks.some(t => t.kind === 'audio');
  // The picture is copied when it can go into an MP4 as it is, as in the volume tool.
  const copy = v.codec === 'h264' || v.codec === 'hevc';
  return {
    ok: true,
    plan: { tool: 'music', mix: mode === 'mix' && hasSound, gainDb, video: copy ? 'copy' : 'hw-h264', durationS: video.durationS, ext: 'mp4' },
  };
}
