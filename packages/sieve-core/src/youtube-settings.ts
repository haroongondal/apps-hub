import { isRecord } from './settings.ts';

export const YOUTUBE_KEY = 'youtube';

export const QUALITIES = ['tiny', 'small', 'medium', 'large', 'hd720', 'hd1080', 'hd1440', 'hd2160', 'hd2880', 'highres'] as const;
export type Quality = (typeof QUALITIES)[number];
export const QUALITY_HEIGHT: Record<Quality, number> = {
  tiny: 144, small: 240, medium: 360, large: 480, hd720: 720, hd1080: 1080, hd1440: 1440, hd2160: 2160, hd2880: 2880, highres: 4320,
};
export type QualityChoice = 'auto' | Quality;
export type FullscreenChoice = 'same' | QualityChoice;
export type SpeedWheel = 'off' | 'over-speed' | 'right-button';
export type VolumeWheel = 'off' | 'over-video' | 'right-button';
export type AutoplayMode = 'allow' | 'background' | 'always';

// Page content Sieve applies to YouTube, not Sieve's own UI colours.
export const ACCENTS: readonly { key: string; label: string; hex: string | null }[] = [
  { key: 'youtube', label: 'YouTube red', hex: null },
  { key: 'red', label: 'Red', hex: '#e53935' },
  { key: 'pink', label: 'Pink', hex: '#d81b60' },
  { key: 'purple', label: 'Purple', hex: '#8e24aa' },
  { key: 'indigo', label: 'Indigo', hex: '#3949ab' },
  { key: 'blue', label: 'Blue', hex: '#1e88e5' },
  { key: 'cyan', label: 'Cyan', hex: '#00acc1' },
  { key: 'teal', label: 'Teal', hex: '#00897b' },
  { key: 'green', label: 'Green', hex: '#43a047' },
  { key: 'lime', label: 'Lime', hex: '#c0ca33' },
  { key: 'yellow', label: 'Yellow', hex: '#fdd835' },
  { key: 'orange', label: 'Orange', hex: '#fb8c00' },
  { key: 'grey', label: 'Grey', hex: '#757575' },
];

export interface VideoFilters { blur: number; brightness: number; contrast: number; grayscale: number; hue: number; invert: number; saturate: number; sepia: number }

export interface YouTubeSettings {
  version: 1;
  on: boolean;
  speed: { setDefault: boolean; default: number; step: number; anySpeed: boolean; wheel: SpeedWheel };
  volume: { setDefault: boolean; level: number; boostOn: boolean; boost: number; step: number; wheel: VolumeWheel };
  reverseWheel: boolean;
  quality: { videos: QualityChoice; videosFull: FullscreenChoice; playlists: QualityChoice; playlistsFull: FullscreenChoice; embeds: QualityChoice; embedsFull: FullscreenChoice; h264: boolean; max30fps: boolean };
  player: { autoTheater: boolean; expand: boolean; cinema: boolean; backdrop: string; backdropOpacity: number; filtersOn: boolean; filters: VideoFilters };
  autoplay: { mode: AutoplayMode; playlists: boolean; pauseOthers: boolean };
  tidy: { hideShorts: boolean; convertShorts: boolean; hideRelated: boolean; hideComments: boolean; hideChat: boolean; newestComments: boolean; expandDescription: boolean; hideCards: boolean; perRow: { home: number; channel: number; shorts: number; posts: number } };
  theme: { dark: boolean; accent: string; css: string };
  experiments: { presets: string[]; overrides: string };
}

function defaults(): YouTubeSettings {
  return {
    version: 1,
    on: true,
    speed: { setDefault: false, default: 1, step: 0.25, anySpeed: true, wheel: 'over-speed' },
    volume: { setDefault: false, level: 50, boostOn: false, boost: 2, step: 5, wheel: 'off' },
    reverseWheel: false,
    quality: { videos: 'auto', videosFull: 'same', playlists: 'auto', playlistsFull: 'same', embeds: 'auto', embedsFull: 'same', h264: false, max30fps: false },
    player: {
      autoTheater: false, expand: false, cinema: false, backdrop: '#000000', backdropOpacity: 85, filtersOn: false,
      filters: { blur: 0, brightness: 100, contrast: 100, grayscale: 0, hue: 0, invert: 0, saturate: 100, sepia: 0 },
    },
    autoplay: { mode: 'allow', playlists: true, pauseOthers: false },
    tidy: {
      hideShorts: false, convertShorts: false, hideRelated: false, hideComments: false, hideChat: false, newestComments: false,
      expandDescription: false, hideCards: false, perRow: { home: 0, channel: 0, shorts: 0, posts: 0 },
    },
    theme: { dark: false, accent: 'youtube', css: '' },
    experiments: { presets: [], overrides: '' },
  };
}

export const DEFAULT_YOUTUBE: YouTubeSettings = defaults();

type Rule = (v: unknown, d: any) => unknown;

const bool: Rule = (v, d) => (typeof v === 'boolean' ? v : d);
const num = (min: number, max: number, decimals = 0): Rule => (v, d) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return d;
  const p = 10 ** decimals;
  return Math.min(max, Math.max(min, Math.round(v * p) / p));
};
const oneOf = (values: readonly string[]): Rule => (v, d) => (typeof v === 'string' && values.includes(v) ? v : d);
const str = (max: number): Rule => (v, d) => (typeof v === 'string' && v.length <= max ? v : d);

const QUALITY_VALUES = ['auto', ...QUALITIES];

const RULES: Record<string, Rule> = {
  version: () => 1,
  'speed.default': num(0.1, 16, 2),
  'speed.step': num(0.05, 1, 2),
  'speed.wheel': oneOf(['off', 'over-speed', 'right-button']),
  'volume.level': num(0, 100),
  'volume.boost': num(1.1, 10, 1),
  'volume.step': num(1, 20),
  'volume.wheel': oneOf(['off', 'over-video', 'right-button']),
  'quality.videos': oneOf(QUALITY_VALUES),
  'quality.videosFull': oneOf(['same', ...QUALITY_VALUES]),
  'quality.playlists': oneOf(QUALITY_VALUES),
  'quality.playlistsFull': oneOf(['same', ...QUALITY_VALUES]),
  'quality.embeds': oneOf(QUALITY_VALUES),
  'quality.embedsFull': oneOf(['same', ...QUALITY_VALUES]),
  'player.backdrop': (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d),
  'player.backdropOpacity': num(0, 100),
  'player.filters.blur': num(0, 20),
  'player.filters.brightness': num(0, 200),
  'player.filters.contrast': num(0, 200),
  'player.filters.grayscale': num(0, 100),
  'player.filters.hue': num(0, 360),
  'player.filters.invert': num(0, 100),
  'player.filters.saturate': num(0, 300),
  'player.filters.sepia': num(0, 100),
  'autoplay.mode': oneOf(['allow', 'background', 'always']),
  'tidy.perRow.home': num(0, 10),
  'tidy.perRow.channel': num(0, 10),
  'tidy.perRow.shorts': num(0, 10),
  'tidy.perRow.posts': num(0, 10),
  'theme.accent': oneOf(ACCENTS.map((a) => a.key)),
  'theme.css': str(100_000),
  'experiments.presets': (v) => {
    const ids = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^[a-z0-9-]{1,40}$/.test(x)) : [];
    return [...new Set(ids)].slice(0, 20);
  },
  'experiments.overrides': str(10_000),
};

function build(def: unknown, input: unknown, path: string): unknown {
  if (isRecord(def)) {
    const inp = isRecord(input) ? input : {};
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(def)) out[k] = build(def[k], inp[k], path ? `${path}.${k}` : k);
    return out;
  }
  return (RULES[path] ?? bool)(input, def);
}

export function validateYouTube(input: unknown): YouTubeSettings {
  if (!isRecord(input) || (input.version !== undefined && input.version !== 1)) return defaults();
  const out = build(defaults(), input, '') as YouTubeSettings;
  // Two right-button wheels would fight over the same gesture.
  if (out.speed.wheel === 'right-button' && out.volume.wheel === 'right-button') out.speed.wheel = 'over-speed';
  return out;
}

function merge(a: unknown, b: unknown): unknown {
  if (!isRecord(b)) return isRecord(a) ? a : b;
  const out: Record<string, unknown> = isRecord(a) ? { ...a } : {};
  for (const k of Object.keys(b)) out[k] = merge(out[k], b[k]);
  return out;
}

export function mergeYouTube(current: YouTubeSettings, patch: unknown): YouTubeSettings {
  if (!isRecord(patch)) return validateYouTube(current);
  const { version: _ignored, ...rest } = patch;
  return validateYouTube(merge(current, rest));
}

export type Field =
  | { path: string; kind: 'switch'; label: string; help?: string }
  | { path: string; kind: 'number'; label: string; min: number; max: number; step: number; unit?: string; help?: string }
  | { path: string; kind: 'select'; label: string; options: readonly { value: string; label: string }[]; help?: string }
  | { path: string; kind: 'color'; label: string; help?: string }
  | { path: string; kind: 'text'; label: string; maxLength: number; help?: string };

export interface FieldGroup { id: string; title: string; help?: string; fields: readonly Field[] }

const sw = (path: string, label: string, help?: string): Field => ({ path, kind: 'switch', label, ...(help ? { help } : {}) });
const nm = (path: string, label: string, min: number, max: number, step: number, unit?: string, help?: string): Field => ({
  path, kind: 'number', label, min, max, step, ...(unit ? { unit } : {}), ...(help ? { help } : {}),
});
const sel = (path: string, label: string, options: readonly { value: string; label: string }[]): Field => ({ path, kind: 'select', label, options });

const QUALITY_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'tiny', label: '144p' },
  { value: 'small', label: '240p' },
  { value: 'medium', label: '360p' },
  { value: 'large', label: '480p' },
  { value: 'hd720', label: '720p' },
  { value: 'hd1080', label: '1080p' },
  { value: 'hd1440', label: '1440p' },
  { value: 'hd2160', label: '2160p (4K)' },
  { value: 'hd2880', label: '2880p (5K)' },
  { value: 'highres', label: '4320p (8K)' },
];
const FULL_OPTIONS = [{ value: 'same', label: 'Same as outside full screen' }, ...QUALITY_OPTIONS];

export const YOUTUBE_GROUPS: readonly FieldGroup[] = [
  {
    id: 'tools',
    title: 'YouTube tools',
    fields: [sw('on', 'YouTube tools', 'Turns the button row and every YouTube feature on or off. Blocking has its own switch.')],
  },
  {
    id: 'speed',
    title: 'Speed',
    fields: [
      sw('speed.setDefault', 'Set a default speed'),
      nm('speed.default', 'Default speed', 0.1, 16, 0.05, '×', 'Each new video starts at this speed.'),
      sw('speed.anySpeed', 'Allow any speed', "Slower and Faster go past YouTube's own speeds, up to 16×."),
      nm('speed.step', 'Speed step', 0.05, 1, 0.05, '×', 'How much Slower and Faster change the speed.'),
      sel('speed.wheel', 'Change speed with the mouse wheel', [
        { value: 'off', label: 'Off' },
        { value: 'over-speed', label: 'Over the speed under the video' },
        { value: 'right-button', label: 'Over the video while holding the right button' },
      ]),
    ],
  },
  {
    id: 'volume',
    title: 'Volume',
    fields: [
      sw('volume.setDefault', 'Set a default volume'),
      nm('volume.level', 'Default volume', 0, 100, 1, '%'),
      sw('volume.boostOn', 'Boost volume'),
      nm('volume.boost', 'Boost', 1.1, 10, 0.1, '×', 'High values distort the sound.'),
      sel('volume.wheel', 'Change volume with the mouse wheel', [
        { value: 'off', label: 'Off' },
        { value: 'over-video', label: 'Over the video' },
        { value: 'right-button', label: 'Over the video while holding the right button' },
      ]),
      nm('volume.step', 'Volume step', 1, 20, 1, '%'),
      sw('reverseWheel', 'Reverse the wheel', 'Applies to speed and volume.'),
    ],
  },
  {
    id: 'quality',
    title: 'Quality',
    help: "If a video doesn't offer the quality you pick, Sieve picks the closest one below it.",
    fields: [
      sel('quality.videos', 'Videos', QUALITY_OPTIONS),
      sel('quality.videosFull', 'Videos in full screen', FULL_OPTIONS),
      sel('quality.playlists', 'Playlists', QUALITY_OPTIONS),
      sel('quality.playlistsFull', 'Playlists in full screen', FULL_OPTIONS),
      sel('quality.embeds', 'Videos on other sites', QUALITY_OPTIONS),
      sel('quality.embedsFull', 'Videos on other sites in full screen', FULL_OPTIONS),
      sw('quality.h264', 'Play H.264 only', 'YouTube offers H.264 up to 1080p, so higher qualities disappear.'),
      sw('quality.max30fps', 'Play at most 30 frames per second'),
    ],
  },
  {
    id: 'player',
    title: 'Player',
    fields: [
      sw('player.autoTheater', 'Open videos in theater mode'),
      sw('player.expand', 'Expand the player to fill the window'),
      sw('player.cinema', 'Cinema mode', 'Dims the page around the player. Click the dimmed part to turn it off.'),
      { path: 'player.backdrop', kind: 'color', label: 'Cinema backdrop colour' },
      nm('player.backdropOpacity', 'Cinema backdrop opacity', 0, 100, 1, '%'),
      sw('player.filtersOn', 'Video filters'),
      nm('player.filters.blur', 'Blur', 0, 20, 1, 'px'),
      nm('player.filters.brightness', 'Brightness', 0, 200, 1, '%'),
      nm('player.filters.contrast', 'Contrast', 0, 200, 1, '%'),
      nm('player.filters.grayscale', 'Grayscale', 0, 100, 1, '%'),
      nm('player.filters.hue', 'Hue', 0, 360, 1, '°'),
      nm('player.filters.invert', 'Invert', 0, 100, 1, '%'),
      nm('player.filters.saturate', 'Saturation', 0, 300, 1, '%'),
      nm('player.filters.sepia', 'Sepia', 0, 100, 1, '%'),
    ],
  },
  {
    id: 'autoplay',
    title: 'Autoplay',
    fields: [
      sel('autoplay.mode', 'Stop videos starting by themselves', [
        { value: 'allow', label: 'Never' },
        { value: 'background', label: 'In tabs opened in the background' },
        { value: 'always', label: 'In every tab' },
      ]),
      sw('autoplay.playlists', 'Let playlists keep playing', 'With autoplay stopped in every tab, playlists still start.'),
      sw('autoplay.pauseOthers', 'Pause other videos when one starts', 'Covers YouTube tabs, and YouTube videos on other sites once they have played.'),
    ],
  },
  {
    id: 'page',
    title: 'Page',
    help: "For videos per row, 0 keeps YouTube's own layout.",
    fields: [
      sw('tidy.hideShorts', 'Hide Shorts'),
      sw('tidy.convertShorts', 'Open Shorts as normal videos'),
      sw('tidy.hideRelated', 'Hide related videos'),
      sw('tidy.hideComments', 'Hide comments'),
      sw('tidy.hideChat', 'Hide live chat'),
      sw('tidy.newestComments', 'Show newest comments first'),
      sw('tidy.expandDescription', 'Expand video descriptions'),
      sw('tidy.hideCards', 'Hide info cards and end screens'),
      nm('tidy.perRow.home', 'Videos per row on Home', 0, 10, 1),
      nm('tidy.perRow.channel', 'Videos per row on channel pages', 0, 10, 1),
      nm('tidy.perRow.shorts', 'Shorts per row', 0, 10, 1),
      nm('tidy.perRow.posts', 'Posts per row', 0, 10, 1),
    ],
  },
  {
    id: 'theme',
    title: 'Theme',
    fields: [
      sw('theme.dark', 'Dark theme'),
      sel('theme.accent', 'Accent colour', ACCENTS.map((a) => ({ value: a.key, label: a.label }))),
      { path: 'theme.css', kind: 'text', label: 'My CSS', maxLength: 100_000, help: 'Sieve adds this to every YouTube page.' },
    ],
  },
  {
    id: 'experiments',
    title: 'Experiments',
    help: 'Changing these can break YouTube. Clear them to undo.',
    fields: [
      { path: 'experiments.overrides', kind: 'text', label: 'Flag overrides', maxLength: 10_000, help: 'One per line: name=true, name=false or name=value.' },
    ],
  },
];

export function getPath(obj: unknown, path: string): unknown {
  let cur = obj;
  for (const k of path.split('.')) {
    if (!isRecord(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

export function setPath<T>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  const src = (isRecord(obj) ? obj : {}) as Record<string, unknown>;
  return { ...src, [head]: rest.length ? setPath(src[head], rest.join('.'), value) : value } as T;
}
