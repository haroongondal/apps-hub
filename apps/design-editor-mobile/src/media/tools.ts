import type { JobSpec } from '@apps-hub/media-core';

export type ToolKey = 'smaller' | 'trim' | 'sound' | 'gif' | 'format' | 'picture' | 'volume' | 'backwards' | 'steady';

// What each tool is called and what it does, in the words a person uses (PRD FR-13).
export const TOOLS: { key: ToolKey; title: string; about: string; accept: ('video' | 'audio')[] }[] = [
  { key: 'smaller', title: 'Make smaller', about: 'Shrink a video to fit Discord, email or WhatsApp.', accept: ['video'] },
  { key: 'trim', title: 'Trim', about: 'Keep only the part you want.', accept: ['video'] },
  { key: 'sound', title: 'Get the sound', about: 'Save the sound from a video as an audio file.', accept: ['video'] },
  { key: 'gif', title: 'Make a GIF', about: 'Turn a short part of a video into a looping picture.', accept: ['video'] },
  { key: 'format', title: 'Change format', about: 'Make an MP4 or an M4A, or take the sound out.', accept: ['video', 'audio'] },
  { key: 'picture', title: 'Save a picture', about: 'Save one moment of a video as an image.', accept: ['video'] },
  { key: 'volume', title: 'Change the volume', about: 'Even out the loudness or make it louder or quieter.', accept: ['video', 'audio'] },
  { key: 'backwards', title: 'Play backwards', about: 'Reverse a short video.', accept: ['video'] },
  { key: 'steady', title: 'Steady a shaky video', about: 'Smooth out camera shake.', accept: ['video'] },
];

export const toolTitle = (key: string | undefined) => TOOLS.find(t => t.key === key)?.title;

// The title a finished or running job shows, from the plan's tool.
const BY_PLAN: Record<JobSpec['tool'], string> = {
  size: 'Make smaller', quality: 'Make smaller', clip: 'Trim', audio: 'Get the sound', gif: 'Make a GIF',
  convert: 'Change format', frame: 'Save a picture', volume: 'Change the volume', reverse: 'Play backwards', stabilize: 'Steady a shaky video',
};
export const planTitle = (tool: string) => BY_PLAN[tool as JobSpec['tool']] ?? 'Video job';

// "1:05.4" or "65.4" or "1:05" -> seconds; undefined when it is not a time.
export function parseTime(text: string): number | undefined {
  const m = /^\s*(?:(\d+):)?(\d{1,2}(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return undefined;
  const value = Number(m[1] ?? 0) * 60 + Number(m[2]);
  return Number.isFinite(value) ? value : undefined;
}
// Times with a tenth of a second, as m:ss.s (PRD FR-5).
export const timeText = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
