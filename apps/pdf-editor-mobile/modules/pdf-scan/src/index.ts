import { requireNativeModule, requireNativeView } from 'expo';
import type { PermissionResponse } from 'expo-modules-core';
import type { Ref } from 'react';
import type { ViewProps } from 'react-native';

/** x,y of top-left, top-right, bottom-right, bottom-left; 0..1 of the upright image. */
export type Quad = [number, number, number, number, number, number, number, number];

// SPEC §6.1. Phase 3 adds importImage, detectQuad and processPage; Phase 4 adds recognition.
export interface PdfScanModule {
  getCameraPermission(): Promise<PermissionResponse>;
  requestCameraPermission(): Promise<PermissionResponse>;
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
  accentColor: string;
  sessionDir: string;
  onQuad?: (e: { nativeEvent: QuadEvent }) => void;
  onCapture?: (e: { nativeEvent: CaptureEvent }) => void;
  onCameraError?: (e: { nativeEvent: CameraErrorEvent }) => void;
}
export const ScanCameraView = requireNativeView<ScanCameraViewProps>('PdfScan');
