import type { AudioPlan, Codec, Planned, Platform, Track } from './types.ts';

// Mac: each track is copied into the container that holds its codec, never re-encoded (RESEARCH §8.2).
const CONTAINERS: Partial<Record<Codec, Pick<AudioPlan, 'container' | 'ext'>>> = {
  aac: { container: 'mp4', ext: 'm4a' }, alac: { container: 'mp4', ext: 'm4a' },
  mp3: { container: 'raw', ext: 'mp3' }, opus: { container: 'ogg', ext: 'opus' }, vorbis: { container: 'ogg', ext: 'ogg' },
  ac3: { container: 'raw', ext: 'ac3' }, eac3: { container: 'raw', ext: 'eac3' }, flac: { container: 'raw', ext: 'flac' },
  pcm: { container: 'raw', ext: 'wav' },
};

// Android (SPEC §9.2): AAC into MP4, Opus into Ogg, Vorbis into WebM, MP3 and AC-3 as raw frames, PCM as WAV. The rest becomes AAC.
const ANDROID: Partial<Record<Codec, Pick<AudioPlan, 'mode' | 'container' | 'ext'>>> = {
  aac: { mode: 'copy', container: 'mp4', ext: 'm4a' }, opus: { mode: 'copy', container: 'ogg', ext: 'opus' },
  vorbis: { mode: 'copy', container: 'webm', ext: 'webm' }, mp3: { mode: 'raw', container: 'raw', ext: 'mp3' },
  ac3: { mode: 'raw', container: 'raw', ext: 'ac3' }, eac3: { mode: 'raw', container: 'raw', ext: 'eac3' },
  pcm: { mode: 'wav', container: 'raw', ext: 'wav' },
};

export function planAudio(track: Track, platform: Platform = 'mac'): Planned<AudioPlan> {
  if (track.kind !== 'audio') return { ok: false, reason: 'invalid', detail: 'This track is not audio.' };
  if (platform === 'android') {
    const own = ANDROID[track.codec];
    return { ok: true, plan: own ? { tool: 'audio', trackIndex: track.index, ...own }
      : { tool: 'audio', trackIndex: track.index, mode: 'aac', container: 'mp4', ext: 'm4a', bps: 192_000 } };
  }
  const out = CONTAINERS[track.codec] ?? { container: 'mka', ext: 'mka' };
  return { ok: true, plan: { tool: 'audio', trackIndex: track.index, mode: 'copy', ...out } };
}
