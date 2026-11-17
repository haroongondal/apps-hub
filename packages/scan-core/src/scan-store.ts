import { migrate } from '@apps-hub/library-core';
import type { Row, SqlPort, SqlValue } from '@apps-hub/library-core';

import { SCAN_STEPS } from './schema.ts';
import type { PageFilter, PageKind, Quad, Rotation, ScanPage } from './types.ts';

const COLUMNS =
  'page_id, position, kind, quad, rotation, filter, width, height, bits_width, bits_height, ocr_state';

const toPage = (r: Row): ScanPage => ({
  pageId: r.page_id as string,
  position: r.position as number,
  kind: r.kind as PageKind,
  quad: JSON.parse(r.quad as string) as Quad,
  rotation: r.rotation as Rotation,
  filter: r.filter as PageFilter,
  width: r.width as number,
  height: r.height as number,
  bitsWidth: r.bits_width as number | null,
  bitsHeight: r.bits_height as number | null,
  ocrState: r.ocr_state as ScanPage['ocrState'],
});

const PATCH_COLUMNS = {
  quad: 'quad',
  rotation: 'rotation',
  filter: 'filter',
  width: 'width',
  height: 'height',
  bitsWidth: 'bits_width',
  bitsHeight: 'bits_height',
} as const;

type PagePatch = Partial<Pick<ScanPage, keyof typeof PATCH_COLUMNS>>;

/** Scan's own table, reached through the Library's connection. The `library` track must have run first. */
export class ScanStore {
  private readonly db: SqlPort;

  constructor(db: SqlPort) {
    this.db = db;
  }

  static async open(db: SqlPort): Promise<ScanStore> {
    await migrate(db, 'scan', SCAN_STEPS);
    return new ScanStore(db);
  }

  async insertPages(tx: SqlPort, itemId: string, pages: ScanPage[]): Promise<void> {
    for (const p of pages) {
      await tx.run(
        `INSERT INTO scan_pages (item_id, page_id, position, kind, quad, rotation, filter, width, height, bits_width, bits_height, ocr_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [itemId, p.pageId, p.position, p.kind, JSON.stringify(p.quad), p.rotation, p.filter, p.width, p.height, p.bitsWidth, p.bitsHeight, p.ocrState],
      );
    }
  }

  async pages(itemId: string): Promise<ScanPage[]> {
    const rows = await this.db.all(`SELECT ${COLUMNS} FROM scan_pages WHERE item_id = ? ORDER BY position`, [itemId]);
    return rows.map(toPage);
  }

  async page(itemId: string, pageId: string): Promise<ScanPage | null> {
    const row = await this.db.first(`SELECT ${COLUMNS} FROM scan_pages WHERE item_id = ? AND page_id = ?`, [itemId, pageId]);
    return row ? toPage(row) : null;
  }

  async updatePage(itemId: string, pageId: string, patch: PagePatch): Promise<void> {
    const sets: string[] = [];
    const params: SqlValue[] = [];
    for (const key of Object.keys(PATCH_COLUMNS) as (keyof PagePatch)[]) {
      const value = patch[key];
      if (value === undefined) continue;
      sets.push(`${PATCH_COLUMNS[key]} = ?`);
      params.push(key === 'quad' ? JSON.stringify(value) : (value as SqlValue));
    }
    if (!sets.length) return;
    await this.db.run(`UPDATE scan_pages SET ${sets.join(', ')} WHERE item_id = ? AND page_id = ?`, [...params, itemId, pageId]);
  }

  async setPositions(itemId: string, pageIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < pageIds.length; i++) {
        await tx.run('UPDATE scan_pages SET position = ? WHERE item_id = ? AND page_id = ?', [i, itemId, pageIds[i]]);
      }
    });
  }

  async deletePage(itemId: string, pageId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await tx.first('SELECT position FROM scan_pages WHERE item_id = ? AND page_id = ?', [itemId, pageId]);
      if (!row) return;
      await tx.run('DELETE FROM scan_pages WHERE item_id = ? AND page_id = ?', [itemId, pageId]);
      await tx.run('UPDATE scan_pages SET position = position - 1 WHERE item_id = ? AND position > ?', [itemId, row.position]);
    });
  }

  async pageTexts(itemId: string): Promise<string[]> {
    const rows = await this.db.all('SELECT ocr_text FROM scan_pages WHERE item_id = ? ORDER BY position', [itemId]);
    return rows.map((r) => (r.ocr_text as string | null) ?? '');
  }

  async nextPosition(itemId: string): Promise<number> {
    const row = await this.db.first('SELECT COALESCE(MAX(position) + 1, 0) AS n FROM scan_pages WHERE item_id = ?', [itemId]);
    return row!.n as number;
  }
}
