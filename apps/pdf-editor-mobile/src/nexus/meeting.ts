import type { Item } from '@apps-hub/library-core';
import { AudioChunks, type MeetingStatus } from 'audio-chunks';
import { AudioModule } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { PermissionsAndroid } from 'react-native';

import { newId } from '../library/ids';
import { openLibrary } from '../library/open-library';

import { addMeeting } from './capture';
import { meetingState, parseSession, sessionText, type MeetingSession, type MeetingState } from './meeting-session';

// One meeting at a time, outside library/ so the start-up sweep never touches it; documents, not cache, so Android keeps it.
const dir = () => new Directory(Paths.document, 'meeting');
const sessionFile = () => new File(dir(), 'session.json');
const recording = () => new File(dir(), 'recording.aac');

export const meetingSupported = AudioChunks !== null;
let starting = false; // until the recorder runs, a session with no sound is not a leftover to clean up

const readSession = async (): Promise<MeetingSession | null> => (sessionFile().exists ? parseSession(await sessionFile().text()) : null);

export const meetingStatus = (): MeetingStatus | null => AudioChunks?.meetingStatus() ?? null;

export function discardMeeting(): void {
  if (dir().exists) dir().delete();
}

export async function currentMeeting(): Promise<MeetingState> {
  if (!AudioChunks) return 'none';
  if (starting) return 'recording';
  const session = await readSession();
  const audio = recording();
  const itemSaved = session?.itemId ? (await (await openLibrary()).allIds()).has(session.itemId) : false;
  const state = meetingState({ recording: AudioChunks.meetingStatus().recording, session, audioBytes: audio.exists ? audio.size : 0, itemSaved });
  if (state !== 'saved' && state !== 'empty') return state;
  discardMeeting();
  return 'none';
}

export async function startMeeting(): Promise<void> {
  if (!AudioChunks) throw new Error('Meeting recording works on Android only.');
  if ((await currentMeeting()) !== 'none') throw new Error('Save or delete the last meeting first.');
  if (!(await AudioModule.requestRecordingPermissionsAsync()).granted) throw new Error('Allow the microphone for Nexus in Android settings to record meetings.');
  await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');
  starting = true;
  try {
    discardMeeting();
    dir().create({ intermediates: true });
    sessionFile().write(sessionText({ startedAt: Date.now(), itemId: null }));
    await AudioChunks.startMeeting(recording().uri);
  } catch (err) {
    discardMeeting();
    throw err;
  } finally {
    starting = false;
  }
}

export async function stopMeeting(): Promise<MeetingStatus> {
  if (!AudioChunks) throw new Error('Meeting recording works on Android only.');
  return AudioChunks.stopMeeting();
}

let saving: Promise<Item> | null = null;

export function saveMeeting(): Promise<Item> {
  saving ??= save().finally(() => {
    saving = null;
  });
  return saving;
}

async function save(): Promise<Item> {
  const session = { startedAt: Date.now(), itemId: null, ...(await readSession()) };
  if (!session.itemId) {
    session.itemId = newId();
    sessionFile().write(sessionText(session)); // before the row exists, so a kill mid-save cannot make a second copy
  }
  return addMeeting(recording().uri, session.itemId, new Date(session.startedAt), discardMeeting);
}
