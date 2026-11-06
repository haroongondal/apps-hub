import { androidContainerFor } from './remux.ts';
import type { Codec, ConvertPlan, ConvertTarget, MediaInfo, Planned, Platform } from './types.ts';

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
export function planConvert(info: MediaInfo, target: ConvertTarget, opts: { videoCodec?: 'h264' | 'hevc'; muted?: boolean } = {}, platform: Platform = 'mac'): Planned<ConvertPlan> {
  if (platform === 'android') return planAndroidConvert(info, target, opts);
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

// Android (PRD FR-8): video to MP4 (H.264 or HEVC), audio to M4A. A copy needs every kept track to fit MP4.
function planAndroidConvert(info: MediaInfo, target: ConvertTarget, opts: { videoCodec?: 'h264' | 'hevc'; muted?: boolean }): Planned<ConvertPlan> {
  const audio = info.tracks.filter(t => t.kind === 'audio');
  const video = info.tracks.find(t => t.kind === 'video');
  if (target === 'm4a') {
    if (!audio.length) return { ok: false, reason: 'invalid', detail: 'This file has no sound to convert.' };
    const copy = audio[0].codec === 'aac';
    return { ok: true, plan: { tool: 'convert', mode: copy ? 'remux' : 'transcode', container: 'm4a', ext: 'm4a',
      audio: copy ? { codec: 'aac', copy: true } : { codec: 'aac', bps: 192_000, copy: false } } };
  }
  if (target !== 'mp4' || !video) return { ok: false, reason: video ? 'invalid' : 'no-video', detail: 'This phone makes MP4 videos and M4A sound.' };
  const wanted = opts.videoCodec ?? video.codec;
  // without sound, only the picture has to fit MP4
  const kept = opts.muted ? { ...info, tracks: info.tracks.filter(t => t.kind === 'video') } : info;
  const videoCopy = wanted === video.codec && androidContainerFor(kept) === 'mp4';
  const audioCopy = audio.every(t => t.codec === 'aac');
  const audioPlan = audio.length === 0 || opts.muted ? undefined : audioCopy ? { codec: audio[0].codec, copy: true } : { codec: 'aac' as const, bps: 192_000, copy: false };
  return { ok: true, plan: { tool: 'convert', mode: videoCopy && (audioCopy || opts.muted) ? 'remux' : 'transcode', container: 'mp4', ext: 'mp4',
    video: videoCopy ? { encoder: 'copy', quality: 0 } : { encoder: wanted === 'hevc' ? 'hw-hevc' : 'hw-h264', quality: 0 }, ...(audioPlan ? { audio: audioPlan } : {}) } };
}
