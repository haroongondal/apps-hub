import type { Item, Library } from '@apps-hub/library-core';

import { pageSizePt } from './paper.ts';
import { writeScanPdf } from './pdf-writer.ts';
import type { PdfPage } from './pdf-writer.ts';
import type { ScanStore } from './scan-store.ts';
import { defaultTitle } from './titles.ts';
import type { PageFilter, PageKind, Quad, Rotation, ScanFiles, ScanNative, ScanPage, SessionInput } from './types.ts';

export type ScanErrorCode = 'no_pages' | 'last_page' | 'not_found' | 'bad_order';

export class ScanError extends Error {
  code: ScanErrorCode;

  constructor(code: ScanErrorCode, message: string = code) {
    super(message);
    this.name = 'ScanError';
    this.code = code;
  }
}

export interface ScanServiceDeps {
  library: Library;
  store: ScanStore;
  native: ScanNative;
  files: ScanFiles;
  libraryDir: string;
  exportDir: string;
  newPageId(): string;
  newItemId(): string;
  /** Clock for the default title; Date.now when omitted. */
  now?(): number;
}

const FULL: Quad = [0, 0, 1, 0, 1, 1, 0, 1];
const CARD_LONG_SIDE = 1600;
const THUMB_LONG_SIDE = 320;
const MAX_FILE_TITLE = 80;
const UNSAFE = /[/\\:*?"<>|#%\u0000-\u001F\u007F-\u009F]/g;

const safeFileTitle = (title: string): string => {
  const cut = Array.from(title.replace(UNSAFE, '-')).slice(0, MAX_FILE_TITLE).join('').trim();
  return cut || 'Scan';
};

type SessionPage = SessionInput['pages'][number];

export class ScanService {
  private readonly d: ScanServiceDeps;

  constructor(deps: ScanServiceDeps) {
    this.d = deps;
  }

  private pagesDir(itemId: string) {
    return `${this.d.libraryDir}/${itemId}/pages`;
  }

  private pageFiles(itemId: string, pageId: string) {
    const stem = `${this.pagesDir(itemId)}/${pageId}`;
    return [`${stem}.orig.jpg`, `${stem}.jpg`, `${stem}.bits`];
  }

  private async requireItem(itemId: string): Promise<Item> {
    const item = await this.d.library.getItem(itemId);
    if (!item || item.kind !== 'scan') throw new ScanError('not_found', `No scan ${itemId}`);
    return item;
  }

  private async requirePage(itemId: string, pageId: string): Promise<ScanPage> {
    const page = await this.d.store.page(itemId, pageId);
    if (!page) throw new ScanError('not_found', `No page ${pageId}`);
    return page;
  }

  /** Copies the original in and processes it; returns the page row to insert. */
  private async writePage(
    itemId: string,
    position: number,
    kind: PageKind,
    p: SessionPage,
    pageId: string,
  ): Promise<ScanPage> {
    const { native, files } = this.d;
    const [orig] = this.pageFiles(itemId, pageId);
    await files.copy(p.file, orig);
    const quad = p.quad ?? FULL;
    const out = await native.processPage({
      src: orig,
      quad,
      rotation: p.rotation,
      filter: p.filter,
      out: `${this.pagesDir(itemId)}/${pageId}`,
      maxLongSide: kind === 'card' ? CARD_LONG_SIDE : undefined,
    });
    return {
      pageId, position, kind, quad, rotation: p.rotation, filter: p.filter,
      width: out.width, height: out.height, bitsWidth: out.bitsWidth, bitsHeight: out.bitsHeight,
      ocrState: 'pending',
    };
  }

  /** Front and back cards go through the native sheet composer and become one 'sheet' page. */
  private async writeSheet(itemId: string, position: number, cards: SessionPage[]): Promise<ScanPage> {
    const { native, files } = this.d;
    const dir = `${this.d.libraryDir}/${itemId}`;
    const front = cards.find((c) => c.side === 'front') ?? cards[0];
    const back = cards.find((c) => c.side === 'back' && c !== front) ?? cards.find((c) => c !== front) ?? null;
    await files.makeDir(`${dir}/tmp`);
    const processed = async (card: SessionPage, name: string) =>
      (
        await native.processPage({
          src: card.file,
          quad: card.quad ?? FULL,
          rotation: card.rotation,
          filter: card.filter,
          out: `${dir}/tmp/${name}`,
          maxLongSide: CARD_LONG_SIDE,
        })
      ).jpg;
    const frontJpg = await processed(front, 'front');
    const backJpg = back ? await processed(back, 'back') : null;
    const pageId = this.d.newPageId();
    await native.composeCardSheet({ front: frontJpg, back: backJpg, out: `${this.pagesDir(itemId)}/${pageId}.orig` });
    await files.remove(`${dir}/tmp`);
    return this.writePageFrom(itemId, position, pageId);
  }

  /** A sheet's original is the composed image already in place: only the processed copy is made. */
  private async writePageFrom(itemId: string, position: number, pageId: string): Promise<ScanPage> {
    const [orig] = this.pageFiles(itemId, pageId);
    const out = await this.d.native.processPage({
      src: orig,
      quad: FULL,
      rotation: 0,
      filter: 'original',
      out: `${this.pagesDir(itemId)}/${pageId}`,
    });
    return {
      pageId, position, kind: 'sheet', quad: FULL, rotation: 0, filter: 'original',
      width: out.width, height: out.height, bitsWidth: null, bitsHeight: null, ocrState: 'pending',
    };
  }

  async saveSession(session: SessionInput, opts: { title?: string } = {}): Promise<Item> {
    const { library, store, files, native } = this.d;
    if (session.pages.length === 0) throw new ScanError('no_pages', 'Add at least one page before saving.');
    const append = session.appendTo !== null;
    const existing = append ? await this.requireItem(session.appendTo!) : null;
    const itemId = existing ? existing.id : this.d.newItemId();
    const dir = `${this.d.libraryDir}/${itemId}`;
    const title = opts.title ?? defaultTitle(session.mode, (this.d.now ?? Date.now)());
    const written: string[] = [];
    let created = false;
    try {
      await files.makeDir(dir);
      await files.makeDir(this.pagesDir(itemId));
      const start = existing ? await store.nextPosition(itemId) : 0;
      const rows: ScanPage[] = [];
      const track = (pageId: string) => written.push(...this.pageFiles(itemId, pageId));
      if (session.mode === 'card' && session.sheet) {
        const row = await this.writeSheet(itemId, start, session.pages);
        track(row.pageId);
        rows.push(row);
      } else {
        const kind: PageKind = session.mode === 'card' ? 'card' : 'page';
        for (const p of session.pages) {
          const pageId = this.d.newPageId();
          track(pageId);
          rows.push(await this.writePage(itemId, start + rows.length, kind, p, pageId));
        }
      }
      if (!existing) {
        const firstRow = rows[0];
        await native.processPage({
          src: this.pageFiles(itemId, firstRow.pageId)[0],
          quad: firstRow.quad,
          rotation: firstRow.rotation,
          filter: 'original',
          out: `${dir}/thumb`,
          maxLongSide: THUMB_LONG_SIDE,
        });
        const item = await library.createItem({
          id: itemId, kind: 'scan', title, folderId: session.folderId,
          pageCount: rows.length, sizeBytes: await files.size(dir),
        });
        created = true;
        await library.db.transaction((tx) => store.insertPages(tx, itemId, rows));
        return item;
      }
      await library.db.transaction((tx) => store.insertPages(tx, itemId, rows));
      return await library.updateItem(itemId, {
        pageCount: start + rows.length,
        sizeBytes: await files.size(dir),
      });
    } catch (error) {
      if (existing) await Promise.all([...written, `${dir}/tmp`].map((f) => files.remove(f).catch(() => {})));
      else {
        if (created) await library.deleteItem(itemId).catch(() => {});
        await files.remove(dir).catch(() => {});
      }
      throw error;
    }
  }

  pages(itemId: string): Promise<ScanPage[]> {
    return this.d.store.pages(itemId);
  }

  async editPage(
    itemId: string,
    pageId: string,
    patch: { quad?: Quad; rotation?: Rotation; filter?: PageFilter },
  ): Promise<ScanPage> {
    const { store, native, files, library } = this.d;
    const page = await this.requirePage(itemId, pageId);
    const next = { quad: patch.quad ?? page.quad, rotation: patch.rotation ?? page.rotation, filter: patch.filter ?? page.filter };
    const out = await native.processPage({
      src: this.pageFiles(itemId, pageId)[0],
      ...next,
      out: `${this.pagesDir(itemId)}/${pageId}`,
      maxLongSide: page.kind === 'card' ? CARD_LONG_SIDE : undefined,
    });
    if (next.filter !== 'bw') await files.remove(this.pageFiles(itemId, pageId)[2]);
    await store.updatePage(itemId, pageId, {
      ...next, width: out.width, height: out.height, bitsWidth: out.bitsWidth, bitsHeight: out.bitsHeight,
    });
    await library.touch(itemId);
    await library.updateItem(itemId, { sizeBytes: await files.size(`${this.d.libraryDir}/${itemId}`) });
    return (await store.page(itemId, pageId))!;
  }

  async reorder(itemId: string, pageIds: string[]): Promise<void> {
    const current = (await this.d.store.pages(itemId)).map((p) => p.pageId);
    const given = new Set(pageIds);
    if (given.size !== pageIds.length || pageIds.length !== current.length || !current.every((id) => given.has(id))) {
      throw new ScanError('bad_order', 'The new order must list every page exactly once.');
    }
    await this.d.store.setPositions(itemId, pageIds);
    await this.d.library.touch(itemId);
  }

  async deletePage(itemId: string, pageId: string): Promise<void> {
    const { store, files, library } = this.d;
    const all = await store.pages(itemId);
    if (!all.some((p) => p.pageId === pageId)) throw new ScanError('not_found', `No page ${pageId}`);
    if (all.length === 1) throw new ScanError('last_page', 'A scan needs at least one page.');
    for (const f of this.pageFiles(itemId, pageId)) await files.remove(f);
    await store.deletePage(itemId, pageId);
    await library.updateItem(itemId, {
      pageCount: all.length - 1,
      sizeBytes: await files.size(`${this.d.libraryDir}/${itemId}`),
    });
  }

  pageTexts(itemId: string): Promise<string[]> {
    return this.d.store.pageTexts(itemId);
  }

  async imagePaths(itemId: string, pageIds?: string[]): Promise<string[]> {
    const all = await this.d.store.pages(itemId);
    if (pageIds) {
      const known = new Set(all.map((p) => p.pageId));
      const unknown = pageIds.find((id) => !known.has(id));
      if (unknown) throw new ScanError('not_found', `No page ${unknown}`);
    }
    const wanted = pageIds ? new Set(pageIds) : null;
    return all.filter((p) => !wanted || wanted.has(p.pageId)).map((p) => this.pageFiles(itemId, p.pageId)[1]);
  }

  async buildPdf(itemId: string): Promise<{ path: string; bytes: number }> {
    const { files, store } = this.d;
    const item = await this.requireItem(itemId);
    const scanned = await store.pages(itemId);
    const pdfPages: PdfPage[] = scanned.map((p) => {
      const [, jpg, bits] = this.pageFiles(itemId, p.pageId);
      const { w, h } = pageSizePt(p.width, p.height);
      const useBits = p.filter === 'bw' && p.bitsWidth !== null && p.bitsHeight !== null;
      return {
        words: [],
        widthPt: w,
        heightPt: h,
        image: async () =>
          useBits
            ? { kind: 'bits', bytes: await files.read(bits), width: p.bitsWidth!, height: p.bitsHeight! }
            : { kind: 'jpeg', bytes: await files.read(jpg) },
      };
    });
    await files.makeDir(this.d.exportDir);
    const path = `${this.d.exportDir}/${safeFileTitle(item.title)}.pdf`;
    const tmp = `${path}.tmp`;
    const sink = await files.open(tmp);
    try {
      const { bytes } = await writeScanPdf(pdfPages, sink, { title: item.title, created: new Date((this.d.now ?? Date.now)()) });
      await sink.close();
      await files.move(tmp, path);
      return { path, bytes };
    } catch (error) {
      await sink.close().catch(() => {});
      await files.remove(tmp).catch(() => {});
      throw error;
    }
  }
}
