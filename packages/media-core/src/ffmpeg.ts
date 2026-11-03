import type { Codec, ConvertPlan, Encoder, GifPlan, Plan, SizePlan } from './types.ts';

const GLOBAL = ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y'];
// An output option: drops location and other container metadata from every output (PRD Q10).
const STRIP = ['-map_metadata', '-1'];
const AUDIO_ENCODERS: Partial<Record<Codec, string>> = { aac: 'aac', mp3: 'libmp3lame', opus: 'libopus', flac: 'flac', pcm: 'pcm_s16le' };

export function ffprobeArgs(input: string): string[] {
  return ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input];
}

export function keyframeArgs(input: string, timeS: number): string[] {
  return ['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time',
    '-read_intervals', `${Math.max(0, timeS - 30).toFixed(3)}%${(timeS + 0.1).toFixed(3)}`, '-of', 'csv=p=0', input];
}

export function parseKeyframe(stdout: string, timeS: number): number {
  const times = stdout.split('\n').filter(l => l.trim() !== '').map(l => Number(l.trim().replace(/,$/, ''))).filter(t => Number.isFinite(t) && t <= timeS + 1e-6);
  return times.length ? Math.max(...times) : 0;
}

export function thumbArgs(input: string, timeS: number): string[] {
  return ['-hide_banner', '-nostats', '-ss', timeS.toFixed(3), '-i', input, '-frames:v', '1', '-vf', 'scale=160:-2',
    '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'];
}

// pass: 1 or 2 for the two-pass libx264 size job; the log is the job's temp file.
export function ffmpegArgs(plan: Plan, input: string, output: string, pass?: { n: 1 | 2; log: string }): string[] {
  switch (plan.tool) {
    case 'size': return sizeArgs(plan, input, output, pass);
    case 'quality': return [...GLOBAL, '-i', input, '-map', '0:v:0', '-map', '0:a?',
      '-vf', `fps=${plan.rung.fps},scale=${plan.width}:${plan.height}`, '-c:v', 'h264_videotoolbox', '-q:v', String(plan.quality),
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', ...STRIP, output];
    case 'clip': {
      const maps = plan.tracks.flatMap(i => ['-map', `0:${i}`]);
      if (plan.mode === 'copy') {
        return [...GLOBAL, '-ss', plan.keyframeS.toFixed(6), '-i', input, '-t', (plan.endS - plan.keyframeS).toFixed(6),
          ...maps, '-c', 'copy', '-avoid_negative_ts', 'make_zero', ...STRIP, output];
      }
      return [...GLOBAL, '-ss', plan.startS.toFixed(6), '-i', input, '-t', (plan.endS - plan.startS).toFixed(6), ...maps,
        '-c:v', 'h264_videotoolbox', '-q:v', '65', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', ...STRIP, output];
    }
    case 'audio': return [...GLOBAL, '-i', input, '-map', `0:${plan.trackIndex}`, '-vn',
      ...(plan.mode === 'aac' ? ['-c:a', 'aac', '-b:a', String(plan.bps ?? 192_000)] : ['-c', 'copy']), ...STRIP, output];
    case 'gif': return [...GLOBAL, '-ss', plan.startS.toFixed(3), '-t', (plan.endS - plan.startS).toFixed(3), '-i', input,
      '-filter_complex', gifGraph(plan), '-loop', '0', '-an', ...STRIP, output];
    case 'convert': return convertArgs(plan, input, output);
    case 'frame': return [...GLOBAL, '-ss', plan.timeS.toFixed(3), '-i', input, '-map', '0:v:0', '-frames:v', '1',
      ...(plan.format === 'jpg' ? ['-q:v', '2'] : []), '-an', ...STRIP, output];
  }
}

export function parseProgress(chunk: string): { outTimeUs?: number; end: boolean } {
  let outTimeUs: number | undefined;
  let end = false;
  for (const line of chunk.split('\n')) {
    const [key, value] = line.trim().split('=');
    if (key === 'out_time_us') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) outTimeUs = n;
    } else if (key === 'progress') {
      end = value === 'end';
    }
  }
  return { outTimeUs, end };
}

function sizeArgs(plan: SizePlan, input: string, output: string, pass?: { n: 1 | 2; log: string }): string[] {
  const video = ['-map', '0:v:0', '-vf', `fps=${plan.rung.fps},scale=${plan.width}:${plan.height}`, ...videoArgs(plan.encoder, plan.videoBps)];
  if (pass?.n === 1) return [...GLOBAL, '-i', input, ...video, '-pass', '1', '-passlogfile', pass.log, '-an', '-f', 'null', '/dev/null'];
  const audio = plan.audio.mode === 'none' ? ['-an']
    : plan.audio.mode === 'copy' ? ['-map', '0:a:0?', '-c:a', 'copy']
      : ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', String(plan.audio.bps)];
  const passArgs = pass ? ['-pass', '2', '-passlogfile', pass.log] : [];
  return [...GLOBAL, '-i', input, ...video, ...passArgs, ...audio, '-movflags', '+faststart', ...STRIP, output];
}

function videoArgs(encoder: Encoder, bps: number): string[] {
  if (encoder === 'x264') return ['-c:v', 'libx264', '-preset', 'medium', '-b:v', String(bps), '-pix_fmt', 'yuv420p'];
  if (encoder === 'hw-hevc') return ['-c:v', 'hevc_videotoolbox', '-b:v', String(bps), '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p'];
  return ['-c:v', 'h264_videotoolbox', '-b:v', String(bps), '-pix_fmt', 'yuv420p'];
}

function gifGraph(plan: GifPlan): string {
  return `fps=${plan.fps},scale=${plan.width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];`
    + '[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle';
}

function convertArgs(plan: ConvertPlan, input: string, output: string): string[] {
  const audioOnly = !plan.video;
  const maps = audioOnly ? ['-map', '0:a:0', '-vn'] : ['-map', '0:v?', ...(plan.audio ? ['-map', '0:a?'] : [])];
  const video = plan.video ? videoConvertArgs(plan.video) : [];
  const audio = !plan.audio ? []
    : plan.audio.copy ? ['-c:a', 'copy']
      : ['-c:a', AUDIO_ENCODERS[plan.audio.codec] ?? 'aac', ...(plan.audio.bps ? ['-b:a', String(plan.audio.bps)] : [])];
  const faststart = plan.container === 'mp4' || plan.container === 'mov' ? ['-movflags', '+faststart'] : [];
  return [...GLOBAL, '-i', input, ...maps, ...video, ...audio, ...faststart, ...STRIP, output];
}

function videoConvertArgs(v: NonNullable<ConvertPlan['video']>): string[] {
  if (v.encoder === 'copy') return ['-c:v', 'copy'];
  if (v.encoder === 'vp9') return ['-c:v', 'libvpx-vp9', '-crf', String(v.quality), '-b:v', '0', '-pix_fmt', 'yuv420p'];
  if (v.encoder === 'hw-hevc') return ['-c:v', 'hevc_videotoolbox', '-q:v', String(v.quality), '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p'];
  return ['-c:v', 'h264_videotoolbox', '-q:v', String(v.quality), '-pix_fmt', 'yuv420p'];
}
