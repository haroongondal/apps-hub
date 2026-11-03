import type { Codec, ConvertPlan, ConvertTarget, MediaInfo, Planned } from './types.ts';

const AUDIO_TARGETS: Partial<Record<ConvertTarget, { copyFrom: Codec[]; encode: Codec; bps?: number }>> = {
  m4a: { copyFrom: ['aac', 'alac'], encode: 'aac', bps: 192_000 },
  mp3: { copyFrom: ['mp3'], encode: 'mp3', bps: 192_000 },
  opus: { copyFrom: ['opus'], encode: 'opus', bps: 128_000 },
  flac: { copyFrom: ['flac'], encode: 'flac' },
  wav: { copyFrom: ['pcm'], encode: 'pcm' },
};

// Mac container rules: which audio codecs each video container takes as a copy ('any' for mkv).
const VIDEO_TARGETS: Partial<Record<ConvertTarget, { copyFrom: Codec[] | 'any'; encode: Codec; bps: number }>> = {
  mp4: { copyFrom: ['aac', 'mp3', 'ac3', 'alac'], encode: 'aac', bps: 192_000 },
  mov: { copyFrom: ['aac', 'alac', 'pcm', 'ac3'], encode: 'aac', bps: 192_000 },
  mkv: { copyFrom: 'any', encode: 'aac', bps: 192_000 },
  webm: { copyFrom: ['opus', 'vorbis'], encode: 'opus', bps: 128_000 },
};

// muted drops every audio track from a video target (the plan has no audio entry, so ffmpegArgs maps none).
export function planConvert(info: MediaInfo, target: ConvertTarget, opts: { videoCodec?: 'h264' | 'hevc'; muted?: boolean } = {}): Planned<ConvertPlan> {
  const audio = info.tracks.filter(t => t.kind === 'audio');
  const video = info.tracks.find(t => t.kind === 'video');
  const audioTarget = AUDIO_TARGETS[target];
  if (audioTarget) {
    if (!audio.length) return { ok: false, reason: 'invalid', detail: 'This file has no audio to convert.' };
    const copy = audioTarget.copyFrom.includes(audio[0].codec);
    return {
      ok: true,
      plan: {
        tool: 'convert', mode: copy ? 'remux' : 'transcode', container: target, ext: target,
        audio: copy ? { codec: audio[0].codec, copy } : { codec: audioTarget.encode, bps: audioTarget.bps, copy },
      },
    };
  }
  const rules = VIDEO_TARGETS[target];
  if (!rules || !video) return { ok: false, reason: 'no-video' };
  const wanted = target === 'webm' ? 'vp9' : opts.videoCodec ?? video.codec;
  const videoCopy = wanted === video.codec;
  const audioCopy = audio.length === 0 || rules.copyFrom === 'any' || audio.every(t => rules.copyFrom.includes(t.codec));
  const videoPlan = videoCopy ? { encoder: 'copy' as const, quality: 0 }
    : target === 'webm' ? { encoder: 'vp9' as const, quality: 33 }
    : { encoder: wanted === 'hevc' ? 'hw-hevc' as const : 'hw-h264' as const, quality: 65 };
  const audioPlan = audio.length === 0 || opts.muted ? undefined
    : audioCopy ? { codec: audio[0].codec, copy: true }
    : { codec: rules.encode, bps: rules.bps, copy: false };
  const mode = videoCopy && (audioCopy || opts.muted) ? 'remux' : 'transcode';
  return {
    ok: true,
    plan: {
      tool: 'convert', mode, container: target, ext: target,
      video: videoPlan, ...(audioPlan ? { audio: audioPlan } : {}),
    },
  };
}
