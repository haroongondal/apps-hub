import { requireNativeModule, requireNativeView } from 'expo';
import type { PermissionResponse } from 'expo-modules-core';
import type { Ref } from 'react';
import type { ViewProps } from 'react-native';

/** x,y of top-left, top-right, bottom-right, bottom-left; 0..1 of the upright image. */
export type Quad = [number, number, number, number, number, number, number, number];

export type PageFilter = 'original' | 'auto' | 'gray' | 'bw';
export type Rotation = 0 | 90 | 180 | 270;

export interface ImportResult { uri: string; width: number; height: number; quad: Quad | null }
export interface ProcessRequest {
  src: string;          // upright original (*.orig.jpg)
  quad: Quad;
  rotation: Rotation;
  filter: PageFilter;
  out: string;          // absolute path without extension; writes <out>.jpg and, for 'bw', <out>.bits
  maxLongSide?: number; // default 2339
}
export interface ProcessResult {
  jpg: string; width: number; height: number;
  bits: string | null; bitsWidth: number | null; bitsHeight: number | null;
}
/** Processed card JPEG paths; out has no extension and gets <out>.jpg (an A4 sheet, 2,480 x 3,508 px). */
export interface SheetRequest { front: string; back: string | null; out: string }
export interface SheetResult { jpg: string; width: number; height: number }

// SPEC §6.1 plus the card sheet and image export (design 2026-11-18). Phase 4 adds recognition.
// Path arguments accept an absolute path or a file:// URI. Errors reject with a CodedException:
// not_found, decode_failed, invalid_quad, out_of_memory, save_failed.
export interface PdfScanModule {
  getCameraPermission(): Promise<PermissionResponse>;
  requestCameraPermission(): Promise<PermissionResponse>;
  /** Decode, apply EXIF orientation, scale to <= 3,000 px, write JPEG quality 90 to dest, detect. */
  importImage(src: string, dest: string): Promise<ImportResult>;
  /** Pass card = true to prefer a card-shaped (1.586:1) quad. */
  detectQuad(src: string, card?: boolean): Promise<Quad | null>;
  processPage(req: ProcessRequest): Promise<ProcessResult>;
  composeCardSheet(req: SheetRequest): Promise<SheetResult>;
  /** Writes each JPEG to Pictures/<album> through MediaStore; returns how many were saved. */
  saveImagesToGallery(paths: string[], album: string): Promise<number>;
  shareImages(paths: string[], chooserTitle: string): Promise<void>;
}
export const PdfScan = requireNativeModule<PdfScanModule>('PdfScan');

export type ScanHint = 'searching' | 'hold' | 'blurry' | 'focusing' | 'captured';
export interface QuadEvent { quad: Quad | null; steady: number; hint: ScanHint }
export interface CaptureEvent {
  uri: string;
  width: number;
  height: number;
  quad: Quad | null;
  auto: boolean;
}
export interface CameraErrorEvent { code: 'unavailable' | 'permission' | 'capture_failed'; message: string }

export interface ScanCameraViewRef { capture(): Promise<void> }
export interface ScanCameraViewProps extends ViewProps {
  ref?: Ref<ScanCameraViewRef>;
  active: boolean;
  autoCapture: boolean;
  torch: boolean;
  cardMode?: boolean;
  accentColor: string;
  sessionDir: string;
  onQuad?: (e: { nativeEvent: QuadEvent }) => void;
  onCapture?: (e: { nativeEvent: CaptureEvent }) => void;
  onCameraError?: (e: { nativeEvent: CameraErrorEvent }) => void;
}
export const ScanCameraView = requireNativeView<ScanCameraViewProps>('PdfScan');
