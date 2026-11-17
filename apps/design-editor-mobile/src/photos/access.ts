import { PermissionsAndroid } from 'react-native';

import { accessFrom, IMAGES, SELECTED, type Access } from './access-map.ts';

export type { Access };

export const askForPhotos = async (): Promise<Access> =>
  accessFrom(await PermissionsAndroid.requestMultiple([IMAGES, SELECTED] as never));

export async function checkPhotos(): Promise<Access> {
  if (await PermissionsAndroid.check(IMAGES as never)) return 'all';
  return (await PermissionsAndroid.check(SELECTED as never)) ? 'some' : 'none';
}
