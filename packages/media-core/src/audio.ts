import type { AudioPlan, Codec, Planned, Track } from './types.ts';

// Mac: each track is copied into the container that holds its codec, never re-encoded (RESEARCH §8.2).
const CONTAINERS: Partial<Record<Codec, Pick<AudioPlan, 'container' | 'ext'>>> = {
  aac: { container: 'mp4', ext: 'm4a' }, alac: { container: 'mp4', ext: 'm4a' },
  mp3: { container: 'raw', ext: 'mp3' }, opus: { container: 'ogg', ext: 'opus' }, vorbis: { container: 'ogg', ext: 'ogg' },
  ac3: { container: 'raw', ext: 'ac3' }, eac3: { container: 'raw', ext: 'eac3' }, flac: { container: 'raw', ext: 'flac' },
  pcm: { container: 'raw', ext: 'wav' },
};

export function planAudio(track: Track): Planned<AudioPlan> {
  if (track.kind !== 'audio') return { ok: false, reason: 'invalid', detail: 'This track is not audio.' };
  const out = CONTAINERS[track.codec] ?? { container: 'mka', ext: 'mka' };
  return { ok: true, plan: { tool: 'audio', trackIndex: track.index, mode: 'copy', ...out } };
}
