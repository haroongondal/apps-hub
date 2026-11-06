import DesignMedia from 'design-media';
import type { Job, MediaInfo, Plan } from '@apps-hub/media-core';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { PermissionsAndroid, Platform } from 'react-native';

import { refreshQueue } from './queue';

const STORE = () => `${FileSystem.documentDirectory}media-jobs.json`;
type Saved = Record<string, Job>;

// "Try again" needs the plan, which the native list does not carry. The app keeps the jobs it started (newest 200).
async function readSaved(): Promise<Saved> {
  try { return JSON.parse(await FileSystem.readAsStringAsync(STORE())) as Saved; } catch { return {}; }
}
export const savedJob = async (id: string) => (await readSaved())[id];
export const forgetJobs = () => FileSystem.deleteAsync(STORE(), { idempotent: true });

export async function pickFiles(accept: ('video' | 'audio')[], multiple = true): Promise<MediaInfo[]> {
  const res = await DocumentPicker.getDocumentAsync({
    type: accept.map(a => `${a}/*`), copyToCacheDirectory: false, multiple,
  });
  if (res.canceled) return [];
  const infos: MediaInfo[] = [];
  for (const asset of res.assets) {
    await DesignMedia.persistAccess(asset.uri);
    infos.push(await DesignMedia.probe(asset.uri));
  }
  return infos;
}

// Notifications show progress while the app is closed; the jobs run either way.
async function askNotifications() {
  if (Platform.OS !== 'android' || Platform.Version < 33) return;
  try { await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS); } catch { /* jobs still run */ }
}

export async function startJobs(items: { info: MediaInfo; plan: Plan }[]): Promise<void> {
  await askNotifications();
  const stamp = Date.now();
  const jobs: Job[] = items.map(({ info, plan }, i) => ({
    id: `${stamp}-${i}`, inputId: info.id, inputName: info.name, plan, state: 'queued', progress: 0, attempt: 1, outputs: [],
  }));
  const saved = await readSaved();
  const keep = Object.entries({ ...saved, ...Object.fromEntries(jobs.map(j => [j.id, j])) }).slice(-200);
  await FileSystem.writeAsStringAsync(STORE(), JSON.stringify(Object.fromEntries(keep)));
  await DesignMedia.enqueue(JSON.stringify(jobs), false);
  await refreshQueue();
}

export async function tryAgain(id: string): Promise<boolean> {
  const job = await savedJob(id);
  if (!job) return false;
  await startJobs([{ info: { id: job.inputId, name: job.inputName } as MediaInfo, plan: job.plan }]);
  return true;
}
