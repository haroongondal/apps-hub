import { requireNativeModule } from 'expo-modules-core';
import type { Job, MediaInfo, Output } from '@apps-hub/media-core';

// Phase 1 subset of SPEC §7.1. Later phases add thumbnails, share, open, resume and clearFinished.
export interface CodecInfo {
  name: string; mime: string; encoder: boolean; hardware: boolean; vendor: boolean;
  bitrateModes: ('cq' | 'vbr' | 'cbr' | 'cbr_fd')[]; maxWidth: number; maxHeight: number; maxFps1080?: number; hdrEditing: boolean;
}
export interface AttemptLog { attempt: number; plannedBytes: number; actualBytes: number; seconds: number; mode: 'vbr' | 'cbr' }
export interface NativeJobStatus {
  id: string; state: Job['state']; progress: number; attempt: number; outputs: Output[]; error?: string; attempts: AttemptLog[];
}
export interface JobProgressEvent { id: string; fraction: number; attempt: number }
export interface QueueEvent { jobs: NativeJobStatus[] }

export interface DesignMediaModule {
  probe(uri: string): Promise<MediaInfo>;
  codecReport(): Promise<CodecInfo[]>;
  persistAccess(uri: string): Promise<boolean>;
  freeBytes(): Promise<number>;
  encoderStats(): Promise<Record<string, number[]>>;
  enqueue(jobsJson: string, cbrFirst: boolean): Promise<string[]>;
  cancel(id: string): Promise<void>;
  queue(): Promise<NativeJobStatus[]>;
  addListener(name: 'onJobProgress', fn: (e: JobProgressEvent) => void): { remove(): void };
  addListener(name: 'onQueue', fn: (e: QueueEvent) => void): { remove(): void };
}

export default requireNativeModule<DesignMediaModule>('DesignMedia');
