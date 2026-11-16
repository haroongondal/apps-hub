export type Access = 'all' | 'some' | 'none' | 'blocked';

export const IMAGES = 'android.permission.READ_MEDIA_IMAGES';
export const SELECTED = 'android.permission.READ_MEDIA_VISUAL_USER_SELECTED';

type Answer = 'granted' | 'denied' | 'never_ask_again';

export function accessFrom(r: Record<string, Answer>): Access {
  if (r[IMAGES] === 'granted') return 'all';
  if (r[SELECTED] === 'granted') return 'some';
  return Object.values(r).includes('never_ask_again') ? 'blocked' : 'none';
}
