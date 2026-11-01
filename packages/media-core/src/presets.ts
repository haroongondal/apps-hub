export interface Destination { id: string; label: string; bytes: number }

// Decimal megabytes (RESEARCH §6.1). WhatsApp is the most conservative published figure (PRD Q4).
export const DESTINATIONS: readonly Destination[] = [
  { id: 'discord', label: 'Discord', bytes: 20_000_000 },
  { id: 'discord-nitro-basic', label: 'Discord Nitro Basic', bytes: 50_000_000 },
  { id: 'email', label: 'Email', bytes: 18_000_000 },
  { id: 'whatsapp', label: 'WhatsApp', bytes: 16_000_000 },
];

// Frame-rate and short-side caps for "compress by quality" (PRD FR-4); bpp is the Android bitrate per pixel.
export const QUALITY_PRESETS = {
  high: { maxShortSide: Infinity, maxFps: Infinity },
  medium: { maxShortSide: 1080, maxFps: 30, bpp: 0.10 },
  small: { maxShortSide: 720, maxFps: 30, bpp: 0.07 },
} as const;
