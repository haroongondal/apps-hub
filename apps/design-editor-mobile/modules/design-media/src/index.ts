import { requireNativeModule } from 'expo-modules-core';
import type { Job, MediaInfo, Output } from '@apps-hub/media-core';

// SPEC §7.1: Phase 1 core plus the Phase 4 calls below.
export interface CodecInfo {
  name: string; mime: string; encoder: boolean; hardware: boolean; vendor: boolean;
  bitrateModes: ('cq' | 'vbr' | 'cbr' | 'cbr_fd')[]; maxWidth: number; maxHeight: number; maxFps1080?: number; hdrEditing: boolean;
}
export interface AttemptLog { attempt: number; plannedBytes: number; actualBytes: number; seconds: number; mode: 'vbr' | 'cbr' }
// tool, inputName and the times let the Queue screen draw a row after the app process was killed and restarted.
export interface NativeJobStatus {
  id: string; state: Job['state']; progress: number; attempt: number; outputs: Output[]; error?: string; attempts: AttemptLog[];
  tool: Job['plan']['tool']; inputName: string; startedAt?: number; finishedAt?: number;
}
export interface JobProgressEvent { id: string; fraction: number; attempt: number }
export interface QueueEvent { jobs: NativeJobStatus[] }

// Phase 3 additions (SPEC §14.3): the page's saveFile for reals — designs written through
// MediaStore where the Files app shows them. saveJson returns the display path; saveExport the
// same for image/vector/pdf exports. base64 crosses the RN bridge already (page refuse cap 30 MB).
export interface DesignMediaModule {
  probe(uri: string): Promise<MediaInfo>;
  codecReport(): Promise<CodecInfo[]>;
  persistAccess(uri: string): Promise<boolean>;
  freeBytes(): Promise<number>;
  encoderStats(): Promise<Record<string, number[]>>;
  enqueue(jobsJson: string, cbrOnly: boolean): Promise<string[]>;
  cancel(id: string): Promise<void>;
  queue(): Promise<NativeJobStatus[]>;
  // Phase 4 (SPEC §7.1). None of these ever deletes an output file (data-safety rule 1).
  keyframeAtOrBefore(uri: string, timeS: number): Promise<number>;
  thumbnails(uri: string, timesS: number[], width: number): Promise<string[]>; // file:// JPEGs in the app cache
  waveform(uri: string, buckets: number): Promise<number[]>; // peak 0..1 per slice of the first sound; [] when there is none
  previewFrame(uri: string, timeS: number, width: number): Promise<string>; // one file:// JPEG, replaced by the next call
  resume(): Promise<void>; // re-queues paused and interrupted jobs
  clearQueue(): Promise<void>; // stops the running job, drops waiting ones, empties the list; outputs stay
  share(outputUri: string): Promise<void>; // ACTION_SEND with a read grant
  open(outputUri: string): Promise<void>; // ACTION_VIEW
  saveJson(name: string, text: string, filePath: string | null): Promise<string>;
  saveExport(name: string, ext: string, base64: string): Promise<string>;
  addListener(name: 'onJobProgress', fn: (e: JobProgressEvent) => void): { remove(): void };
  addListener(name: 'onQueue', fn: (e: QueueEvent) => void): { remove(): void };
}

export default requireNativeModule<DesignMediaModule>('DesignMedia');
export { CompositionView, type CompositionViewHandle, type CompositionViewProps } from './CompositionView';
