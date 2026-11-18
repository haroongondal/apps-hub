// Mirrors modules/pdf-scan/src/index.ts; scan-core is pure TS and can't import the native module.

export type Quad = [number, number, number, number, number, number, number, number];
export type PageFilter = 'original' | 'auto' | 'gray' | 'bw';
export type Rotation = 0 | 90 | 180 | 270;
/** 'card' pages process at a long side of 1,600 px; a 'sheet' is front and back on one A4 page. */
export type PageKind = 'page' | 'card' | 'sheet';

export interface OcrWord {
  t: string;
  b: [number, number, number, number];
  c: number;
  l: number;
}

export interface ScanPage {
  pageId: string;
  position: number;
  kind: PageKind;
  quad: Quad;
  rotation: Rotation;
  filter: PageFilter;
  width: number;
  height: number;
  bitsWidth: number | null;
  bitsHeight: number | null;
  ocrState: 'pending' | 'done' | 'failed';
}

export interface SessionInput {
  folderId: string | null;
  appendTo: string | null;
  mode: 'document' | 'card';
  sheet: boolean;
  pages: {
    file: string;
    quad: Quad | null;
    rotation: Rotation;
    filter: PageFilter;
    side: 'front' | 'back' | null;
  }[];
}

export interface ProcessRequest {
  src: string;
  quad: Quad;
  rotation: Rotation;
  filter: PageFilter;
  out: string;
  maxLongSide?: number;
}
export interface ProcessResult {
  jpg: string;
  width: number;
  height: number;
  bits: string | null;
  bitsWidth: number | null;
  bitsHeight: number | null;
}

export interface ScanNative {
  processPage(req: ProcessRequest): Promise<ProcessResult>;
  composeCardSheet(req: { front: string; back: string | null; out: string }): Promise<{ jpg: string; width: number; height: number }>;
}

export interface ByteSink {
  write(bytes: Uint8Array): Promise<void> | void;
}

export interface ScanFiles {
  makeDir(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  size(path: string): Promise<number>;
  read(path: string): Promise<Uint8Array>;
  open(path: string): Promise<ByteSink & { close(): Promise<void> }>;
}
