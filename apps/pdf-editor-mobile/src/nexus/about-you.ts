import type { AboutYou, AskContext } from '@apps-hub/knowledge-core';
import type { SqlPort } from '@apps-hub/library-core';

import type { Cv } from '../cv/model.ts';

type MetaDb = Pick<SqlPort, 'first' | 'run'>;

const NAME = 'about:name';
const NOTES = 'about:notes';
const MAX_NAME = 120;
export const MAX_NOTES = 2000;
const MAX_CVS = 3;
const MAX_CV_CHARS = 6000;
const UPSERT = 'INSERT INTO kn_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value';

export const NAME_NUDGE = 'Tell Nexus your name in AI settings, under About you, so it can tell your documents from other people\'s.';

export async function readAbout(db: MetaDb): Promise<Required<AboutYou>> {
  const get = async (key: string) => ((await db.first('SELECT value FROM kn_meta WHERE key = ?', [key]))?.value as string | undefined) ?? '';
  return { name: await get(NAME), notes: await get(NOTES) };
}

export async function saveAbout(db: MetaDb, about: AboutYou): Promise<void> {
  await db.run(UPSERT, [NAME, (about.name ?? '').trim().slice(0, MAX_NAME)]);
  await db.run(UPSERT, [NOTES, (about.notes ?? '').trim().slice(0, MAX_NOTES)]);
}

export function cvText(cv: Cv): string {
  const lines = [cv.name, cv.title, ...cv.contact];
  for (const s of cv.sections) {
    lines.push(`${s.heading}:`);
    for (const e of s.entries) lines.push([e.title, e.subtitle, e.dates].filter(Boolean).join(', '), ...e.lines);
  }
  return lines.filter(Boolean).join('\n').slice(0, MAX_CV_CHARS);
}

/** The owner's own words and CVs go to the model with a question about them; both stay on the phone until then. */
export async function askContext(db: MetaDb, cvs: () => Promise<Cv[]>): Promise<AskContext> {
  const about = await readAbout(db);
  const list = await cvs().catch((err) => {
    console.warn('Nexus could not read the saved CVs for Ask', err);
    return [] as Cv[];
  });
  return {
    about: { name: about.name || undefined, notes: about.notes || undefined },
    extras: list.slice(0, MAX_CVS).map((cv) => ({ id: `cv:${cv.id}`, title: `CV: ${cv.name}`, text: cvText(cv) })),
  };
}
