import type { Codec, MediaInfo, Track } from './types.ts';

// The fields of `ffprobe -print_format json -show_format -show_streams` that the planners use.
export interface FfprobeStream {
  index: number; codec_type?: string; codec_name?: string; width?: number; height?: number;
  avg_frame_rate?: string; r_frame_rate?: string; channels?: number; sample_rate?: string; bit_rate?: string;
  duration?: string; color_transfer?: string; tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[]; disposition?: { attached_pic?: number };
}
export interface FfprobeJson { format: { duration?: string; size?: string }; streams: FfprobeStream[] }

const CONTAINERS: Record<string, MediaInfo['container']> = {
  mp4: 'mp4', m4v: 'mp4', mov: 'mov', mkv: 'mkv', webm: 'webm', mp3: 'mp3', m4a: 'm4a', ogg: 'ogg', opus: 'ogg', wav: 'wav', flac: 'flac',
};
const CODECS: Record<string, Codec> = {
  h264: 'h264', hevc: 'hevc', vp8: 'vp8', vp9: 'vp9', av1: 'av1', mpeg4: 'mpeg4', prores: 'prores', aac: 'aac', alac: 'alac',
  mp3: 'mp3', opus: 'opus', vorbis: 'vorbis', ac3: 'ac3', eac3: 'eac3', flac: 'flac', dts: 'dts', truehd: 'truehd',
};

export function normaliseCodec(name: string): Codec {
  if (name.startsWith('pcm_')) return 'pcm';
  return CODECS[name] ?? 'other';
}

// Width and height are the displayed size: a 90° or 270° rotation swaps them, as on the phone.
export function fromFfprobe(json: FfprobeJson, id: string, name: string): MediaInfo {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const durationS = Number(json.format.duration) || Math.max(0, ...json.streams.map(s => Number(s.duration) || 0));
  return {
    id, name, bytes: Number(json.format.size) || 0, durationS,
    container: CONTAINERS[ext] ?? 'other',
    tracks: json.streams.map(toTrack),
  };
}

function toTrack(s: FfprobeStream): Track {
  const kind: Track['kind'] = s.codec_type === 'audio' ? 'audio' : s.codec_type === 'video' && !s.disposition?.attached_pic ? 'video' : 'other';
  const track: Track = { index: s.index, kind, codec: normaliseCodec(s.codec_name ?? '') };
  if (kind === 'video') {
    const rotation = rotationOf(s);
    const swap = rotation === 90 || rotation === 270;
    track.width = swap ? s.height : s.width;
    track.height = swap ? s.width : s.height;
    track.rotation = rotation;
    const fps = fpsOf(s);
    if (fps !== undefined) track.fps = fps;
    if (s.color_transfer === 'smpte2084' || s.color_transfer === 'arib-std-b67') track.hdr = true;
  }
  if (kind === 'audio') {
    if (s.channels) track.channels = s.channels;
    if (s.sample_rate) track.sampleRate = Number(s.sample_rate);
  }
  if (s.tags?.language) track.language = s.tags.language;
  const bitrate = Number(s.bit_rate);
  if (bitrate > 0) track.bitrate = bitrate;
  return track;
}

function rotationOf(s: FfprobeStream): 0 | 90 | 180 | 270 {
  const side = s.side_data_list?.find(d => typeof d.rotation === 'number')?.rotation;
  const raw = side ?? Number(s.tags?.rotate ?? 0);
  const r = ((-raw % 360) + 360) % 360;
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

function fpsOf(s: FfprobeStream): number | undefined {
  for (const value of [s.avg_frame_rate, s.r_frame_rate]) {
    const [num, den] = (value ?? '').split('/').map(Number);
    if (num > 0 && den > 0) return Math.round(num / den * 100) / 100;
  }
  return undefined;
}
