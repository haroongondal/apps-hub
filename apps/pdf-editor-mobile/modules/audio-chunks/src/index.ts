import { requireOptionalNativeModule } from 'expo';

export interface MeetingStatus {
  recording: boolean;
  elapsedMs: number;
  /** Another app (a call, an assistant) has the microphone, so the recording gets silence. */
  silenced: boolean;
  silencedMs: number;
  /** Why the last recording ended without Stop, if it did. */
  error: string | null;
}

// Errors reject with a CodedException: READ_FAILED, CUT_FAILED, START_FAILED.
export interface AudioChunksModule {
  /** Length of a local recording (file:// URI or path). */
  durationMs(uri: string): Promise<number>;
  /** Copies `startMs..endMs` of the recording to `outUri` as M4A without re-encoding; resolves its size in bytes. */
  cut(uri: string, startMs: number, endMs: number, outUri: string): Promise<number>;
  startMeeting(outUri: string): Promise<void>;
  stopMeeting(): Promise<MeetingStatus>;
  meetingStatus(): MeetingStatus;
}

// Android only: on iOS this is null, long recordings stay too long to transcribe and there is no meeting mode.
export const AudioChunks = requireOptionalNativeModule<AudioChunksModule>('AudioChunks');
