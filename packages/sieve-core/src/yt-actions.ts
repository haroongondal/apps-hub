// `command` is the label the shortcut list shows.
export const YT_ACTIONS = [
  { id: 'loop', command: 'Loop on or off' },
  { id: 'stop', command: 'Stop the video' },
  { id: 'reverse-playlist', command: 'Reverse the playlist on or off' },
  { id: 'speed-down', command: 'Slower' },
  { id: 'speed-up', command: 'Faster' },
  { id: 'speed-default', command: 'Default speed' },
  { id: 'speed-normal', command: 'Normal speed' },
  { id: 'boost', command: 'Volume boost on or off' },
  { id: 'cinema', command: 'Cinema mode on or off' },
  { id: 'expand', command: 'Expand the player on or off' },
  { id: 'filters', command: 'Video filters on or off' },
  { id: 'flip-h', command: 'Flip horizontally' },
  { id: 'flip-v', command: 'Flip vertically' },
  { id: 'screenshot', command: 'Take a screenshot' },
  { id: 'pip', command: 'Picture-in-picture' },
  { id: 'comments', command: 'Show or hide comments' },
  { id: 'related', command: 'Show or hide related videos' },
  { id: 'cards', command: 'Show or hide info cards and end screens' },
  { id: 'quality-auto', command: 'Quality auto' },
  { id: 'quality-tiny', command: 'Quality 144p' },
  { id: 'quality-small', command: 'Quality 240p' },
  { id: 'quality-medium', command: 'Quality 360p' },
  { id: 'quality-large', command: 'Quality 480p' },
  { id: 'quality-hd720', command: 'Quality 720p' },
  { id: 'quality-hd1080', command: 'Quality 1080p' },
  { id: 'quality-hd1440', command: 'Quality 1440p' },
  { id: 'quality-hd2160', command: 'Quality 2160p' },
  { id: 'quality-hd2880', command: 'Quality 2880p' },
  { id: 'quality-highres', command: 'Quality 4320p' },
] as const;

export type YtActionId = (typeof YT_ACTIONS)[number]['id'];

export const ROW_ORDER: readonly string[] = ['loop', 'speed-down', 'speed', 'speed-up', 'boost', 'cinema', 'expand', 'filters', 'flip', 'screenshot', 'pip', 'download', 'settings'];

export const SETTINGS_COMMAND = 'open-settings';

// No suggested_key: the owner binds keys on chrome://extensions/shortcuts.
export function commandsManifest(): Record<string, { description: string }> {
  const out: Record<string, { description: string }> = {};
  for (const a of YT_ACTIONS) out[`yt-${a.id}`] = { description: `YouTube: ${a.command[0].toLowerCase()}${a.command.slice(1)}` };
  out[SETTINGS_COMMAND] = { description: 'Open Sieve settings' };
  return out;
}

export function actionOfCommand(command: string): YtActionId | null {
  if (!command.startsWith('yt-')) return null;
  const id = command.slice(3);
  return YT_ACTIONS.find((a) => a.id === id)?.id ?? null;
}
