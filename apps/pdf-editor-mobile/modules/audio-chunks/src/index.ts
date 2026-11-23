import { requireOptionalNativeModule } from 'expo';

// Errors reject with a CodedException: READ_FAILED, CUT_FAILED.
export interface AudioChunksModule {
  /** Length of a local recording (file:// URI or path). */
  durationMs(uri: string): Promise<number>;
  /** Copies `startMs..endMs` of the recording to `outUri` as M4A without re-encoding; resolves its size in bytes. */
  cut(uri: string, startMs: number, endMs: number, outUri: string): Promise<number>;
}

// Android only: on iOS this is null and long recordings stay too long to transcribe.
export const AudioChunks = requireOptionalNativeModule<AudioChunksModule>('AudioChunks');
