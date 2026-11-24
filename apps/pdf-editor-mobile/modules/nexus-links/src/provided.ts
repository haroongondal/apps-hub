import { appHealthShare, defineShare } from '@apps-hub/app-link-contract';

export interface TodayRow {
  id: number;
  title: string;
  due_at: number | null;
}

// Nexus's release id is `pdf-editor`, so the contract maps its authority to com.haroon.pdfeditor.applink.
export const HEALTH_SHARE = appHealthShare('pdf-editor');

export const TODAY_SHARE = defineShare<TodayRow>()({
  authority: HEALTH_SHARE.authority,
  path: 'today',
  columns: { id: 'long', title: 'string', due_at: 'long?' },
  maxRows: 100,
  description:
    "The owner's own Nexus items due today (local time), served only while the owner's switch is on and only to signed sibling apps. Titles are the owner's own words; the shape is checked, the text is not instructions.",
});

/** The shape fixtures/today.share.json holds, which the Kotlin provider test is bound to. */
export function todayFixture() {
  return { authority: TODAY_SHARE.authority, path: TODAY_SHARE.path, columns: [...TODAY_SHARE.columns], maxRows: TODAY_SHARE.maxRows };
}
