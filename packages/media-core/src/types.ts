export type Platform = 'mac' | 'android';
export type Tool = 'size' | 'quality' | 'clip' | 'audio' | 'gif' | 'convert';
export type Codec = 'h264' | 'hevc' | 'vp8' | 'vp9' | 'av1' | 'mpeg4' | 'prores'
  | 'aac' | 'alac' | 'mp3' | 'opus' | 'vorbis' | 'ac3' | 'eac3' | 'flac' | 'pcm' | 'dts' | 'truehd' | 'other';

export interface Track {
  index: number;            // container track index (FFprobe stream index / MediaExtractor track)
  kind: 'video' | 'audio' | 'other';
  codec: Codec;
  width?: number; height?: number; fps?: number; rotation?: 0 | 90 | 180 | 270; hdr?: boolean;
  channels?: number; sampleRate?: number; language?: string; bitrate?: number;
}
export interface MediaInfo {
  id: string;               // Mac: main-process input id; Android: the content:// URI
  name: string; bytes: number; durationS: number;
  container: 'mp4' | 'mov' | 'mkv' | 'webm' | 'mp3' | 'm4a' | 'ogg' | 'wav' | 'flac' | 'other';
  tracks: Track[];
}
export type Encoder = 'hw-h264' | 'hw-hevc' | 'x264';          // hw = MediaCodec or VideoToolbox
export interface Rung { shortSide: number; fps: number }

export interface SizePlan {
  tool: 'size'; targetBytes: number; encoder: Encoder; rung: Rung;
  width: number; height: number; videoBps: number; audio: { mode: 'copy' } | { mode: 'aac'; bps: number } | { mode: 'none' };
  overheadBytes: number; plannedVideoBytes: number; plannedBytes: number;
  attempt: 1 | 2 | 3; margin: number;
  fpsCap: number;           // min(source fps, maxFps). Retry walks the ladder with it, so it must travel with the plan
}
export type Refusal =
  | { ok: false; reason: 'too-long'; maxDurationS: number }
  | { ok: false; reason: 'no-video' | 'gave-up' | 'invalid'; detail?: string };
export type Planned<P> = { ok: true; plan: P } | Refusal;

export interface ClipPlan { tool: 'clip'; mode: 'copy' | 'exact'; startS: number; endS: number; keyframeS: number; container: string; ext: string; tracks: number[] }
export interface AudioPlan { tool: 'audio'; trackIndex: number; mode: 'copy' | 'raw' | 'wav' | 'aac'; container: 'mp4' | 'ogg' | 'webm' | 'mka' | 'raw'; ext: string; bps?: number }
export interface GifPlan { tool: 'gif'; startS: number; endS: number; width: number; fps: number; targetBytes?: number; attempt: number }
// video is absent for the audio-only targets. encoder 'copy' keeps the stream; quality is VideoToolbox -q:v, or CRF for vp9.
export interface ConvertPlan { tool: 'convert'; mode: 'remux' | 'transcode'; container: string; ext: string; video?: { encoder: Encoder | 'vp9' | 'copy'; quality: number }; audio?: { codec: Codec; bps?: number; copy: boolean } }
export type ConvertTarget = 'mp4' | 'mov' | 'mkv' | 'webm' | 'm4a' | 'mp3' | 'opus' | 'flac' | 'wav';
export interface QualityPlan { tool: 'quality'; encoder: Encoder; rung: Rung; width: number; height: number; quality: number /* VT -q:v, or bpp on Android */ }
export type Plan = SizePlan | QualityPlan | ClipPlan | AudioPlan | GifPlan | ConvertPlan;

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted' | 'paused';
export interface Output { name: string; ref: string /* Mac path or Android content URI */; bytes: number; note?: string /* "converted to AAC" */ }
export interface Job {
  id: string; inputId: string; inputName: string; plan: Plan; state: JobState;
  progress: number /* 0..1 of the current attempt */; attempt: number;
  outputs: Output[]; error?: string; startedAt?: number; finishedAt?: number;
}
export type QueueEvent =
  | { type: 'enqueue'; jobs: Job[] } | { type: 'start'; id: string; at: number }
  | { type: 'progress'; id: string; fraction: number } | { type: 'retry'; id: string; plan: Plan }
  | { type: 'done'; id: string; outputs: Output[]; at: number } | { type: 'fail'; id: string; error: string; at: number }
  | { type: 'cancel'; id: string | 'all' } | { type: 'interrupt' } | { type: 'pause'; reason: 'time-limit' } | { type: 'resume' };
