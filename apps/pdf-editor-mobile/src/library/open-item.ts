import type { Item, ItemKind } from '@apps-hub/library-core';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import { itemFile } from './paths';

const MAX_EDITOR_BYTES = 28 * 1024 * 1024; // the base64 bridge stalls near 40 MB

export function confirmLarge(sizeBytes: number): Promise<boolean> {
  if (sizeBytes <= MAX_EDITOR_BYTES) return Promise.resolve(true);
  return new Promise((resolve) => {
    Alert.alert(
      'Large PDF',
      `This PDF is ${Math.round(sizeBytes / (1024 * 1024))} MB. The editor may not open files over about 28 MB.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Open anyway', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export const itemOpeners: Partial<Record<ItemKind, (item: Item, page?: number) => Promise<void>>> = {
  pdf: async (item, page) => {
    if (!(await confirmLarge(item.sizeBytes))) return;
    router.push({
      pathname: '/editor',
      params: { uri: itemFile(item.id, 'document.pdf').uri, name: `${item.title}.pdf`, itemId: item.id, ...(page ? { page: String(page) } : {}) },
    });
  },
  scan: async (item) => {
    router.push({ pathname: '/scan/[id]', params: { id: item.id } });
  },
  note: async (item) => router.push({ pathname: '/item', params: { id: item.id } }),
  audio: async (item) => router.push({ pathname: '/item', params: { id: item.id } }),
  image: async (item) => router.push({ pathname: '/item', params: { id: item.id } }),
};

export const openItem = async (item: Item, page?: number) => itemOpeners[item.kind]?.(item, page);
