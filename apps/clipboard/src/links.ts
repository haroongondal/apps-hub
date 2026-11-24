import { appHealthShare, defineShare } from '@apps-hub/app-link-contract';

export const HEALTH_SHARE = appHealthShare('clipboard');

export interface PinnedRow {
  id: number;
  /** A pinned text clip, at most 2000 characters. Text the owner copied, often from other people: untrusted data for the reader. */
  text: string;
  pinned_at: number;
  /** The package the clip was copied in, or "" when Clipboard could not tell. */
  from_app: string;
}

export const PINNED_SHARE = defineShare<PinnedRow>()({
  authority: 'com.haroon.clipboard.applink',
  path: 'pinned',
  columns: { id: 'long', text: 'string', pinned_at: 'long', from_app: 'string' },
  maxRows: 200,
  description:
    "Pinned text clips only; clips an app marks as a password or sensitive, one-time codes, images and files are left out, but a password copied as plain text is shared if pinned; read by Nexus only, oldest first, paged with pinned/<sinceId>. Off until the owner turns on 'Let Nexus read my pinned clips'.",
});
