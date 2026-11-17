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
export interface VisionToolEntry { tool: 'person' | 'object' | 'upscale'; name: string; url: string; bytes: number; ready: boolean }
export interface VisionProgressEvent { id: string; fraction: number }
export type CleanupKind = 'blurry' | 'copies' | 'lookalikes' | 'screenshots' | 'dark';
export interface CleanupPhoto { uri: string; name: string; bytes: number; takenAt: number; ticked: boolean; best: boolean }
export interface CleanupGroup { kind: CleanupKind; key: string; photos: CleanupPhoto[]; bytes: number } // bytes of the photos suggested for removal (all of them, or all but the keeper)
export interface CleanupResult {
  groups: CleanupGroup[]; blur: { min: number; max: number; default: number }; lookalike: { default: number; strict: number }; indexed: number;
}
export interface RemovedPhoto { uri: string; name: string; bytes: number; trashedAt: number; expiresAt: number }

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
  thumbnails(uri: string, timesS: number[], width: number, folder?: string): Promise<string[]>; // file:// JPEGs in the app cache; each call replaces the folder's last set
  clearThumbs(folder: string): Promise<void>; // deletes a picture folder and everything in it
  waveform(uri: string, buckets: number): Promise<number[]>; // peak 0..1 per slice of the first sound; [] when there is none
  previewFrame(uri: string, timeS: number, width: number): Promise<string>; // one file:// JPEG, replaced by the next call
  resume(): Promise<void>; // re-queues paused and interrupted jobs
  clearQueue(): Promise<void>; // stops the running job, drops waiting ones, empties the list; outputs stay
  share(outputUri: string): Promise<void>; // ACTION_SEND with a read grant
  open(outputUri: string): Promise<void>; // ACTION_VIEW
  // Photo search: the pinned model files, the index job and the search itself. Nothing here uses the network.
  photoModels(): Promise<{ name: string; url: string; bytes: number; ready: boolean }[]>;
  installPhotoModel(name: string): Promise<boolean>; // checks a finished download, then keeps it; false when it is damaged
  startPhotoIndex(): Promise<string>; // the job id; the one already waiting when there is one
  photoIndexState(): Promise<{ indexed: number; modelsReady: boolean; waiting: 'heat' | 'battery' | null; lastScan: number }>; // waiting: why a running scan is holding back; lastScan: ms when the last scan finished, 0 if never
  photoGalleryChanged(): Promise<boolean>; // true when photos changed since the last finished scan, or none has finished
  searchPhotos(query: string): Promise<string[]>; // content URIs, best first, at most 60
  similarPhotos(uri: string): Promise<string[]>; // photos that look like this one, not including it
  releasePhotoSearch(): Promise<void>; // frees the text model's memory
  // Clean up: groups from the photo index. A photo leaves the gallery only through Android's own trash dialog.
  cleanupGroups(options?: { blurThreshold?: number; lookalikeCosine?: number }): Promise<CleanupResult>; // photos still in the gallery only
  trashPhotos(uris: string[]): Promise<{ moved: number; uris: string[] }>; // opens Android's dialog; 0 and [] when the owner says no; uris: the ones sent, for Undo
  recentlyRemoved(): Promise<RemovedPhoto[]>; // trashed here in the last 30 days and still in Android's trash
  restorePhotos(uris: string[]): Promise<{ restored: number; uris: string[] }>; // opens Android's dialog; 0 and [] when the owner says no
  dismissCleanup(kind: CleanupKind, uris: string[]): Promise<void>; // "Not a mistake": never shown in that kind again
  undismissCleanup(kind: CleanupKind, uris: string[]): Promise<void>; // undoes dismissCleanup for just these photos
  clearCleanupDismissals(): Promise<void>; // brings every dismissed photo back
  // Quick edits: cut-out and upscale models. Same download-then-install steps as the photo models above.
  visionTools(): Promise<VisionToolEntry[]>;
  installVisionModel(name: string): Promise<boolean>; // file name, like installPhotoModel
  runVision(id: string, op: 'cutout' | 'upscale', src: string, option: string): Promise<string>; // option 'person'|'object' or '2'|'4'; returns the PNG's absolute path
  cancelVision(id: string): Promise<void>;
  saveJson(name: string, text: string, filePath: string | null): Promise<string>;
  saveExport(name: string, ext: string, base64: string): Promise<string>;
  addListener(name: 'onJobProgress', fn: (e: JobProgressEvent) => void): { remove(): void };
  addListener(name: 'onQueue', fn: (e: QueueEvent) => void): { remove(): void };
  addListener(name: 'onVisionProgress', fn: (e: VisionProgressEvent) => void): { remove(): void };
}

export default requireNativeModule<DesignMediaModule>('DesignMedia');
export { CompositionView, type CompositionViewHandle, type CompositionViewProps } from './CompositionView';
