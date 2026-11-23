import type { AutoplayMode } from './youtube-settings.ts';

export interface PlayContext {
  mode: AutoplayMode;
  playlists: boolean;
  loadedHidden: boolean;
  firstVideo: boolean;
  inPlaylist: boolean;
  firstPlay: boolean;
  sincePlayerInput: number; // ms since the last trusted click or key in the player; Infinity if none
}

// Whether a video that just started playing should be paused again.
export function stopThisPlay(c: PlayContext): boolean {
  if (!c.firstPlay || c.sincePlayerInput < 1000 || c.mode === 'allow') return false;
  if (c.mode === 'background') return c.loadedHidden && c.firstVideo;
  return !(c.playlists && c.inPlaylist);
}
