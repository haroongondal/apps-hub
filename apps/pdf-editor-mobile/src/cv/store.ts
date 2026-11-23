import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { newId } from '../library/ids';

import { renderCvPdf } from './pdf.ts';
import type { Cv, CvBody, TemplateId } from './model.ts';
import { TEMPLATES } from './templates.ts';

const folder = () => {
  const dir = new Directory(Paths.document, 'cv');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
};

const fileFor = (id: string) => new File(folder(), `${id}.json`);

export function newCv(body: CvBody, template: TemplateId): Cv {
  return { ...body, id: newId(), template, updated: new Date().toISOString() };
}

export async function listCvs(): Promise<Cv[]> {
  const files = folder().list().filter((f): f is File => f instanceof File && f.name.endsWith('.json'));
  const cvs = await Promise.all(
    files.map(async (f) => {
      try {
        return JSON.parse(await f.text()) as Cv;
      } catch (err) {
        console.warn('A saved CV could not be read', err);
        return null;
      }
    }),
  );
  return cvs.filter((cv): cv is Cv => cv !== null).sort((a, b) => b.updated.localeCompare(a.updated));
}

export async function loadCv(id: string): Promise<Cv | null> {
  const file = fileFor(id);
  return file.exists ? (JSON.parse(await file.text()) as Cv) : null;
}

export function saveCv(cv: Cv): void {
  fileFor(cv.id).write(JSON.stringify(cv));
}

export function deleteCv(id: string): void {
  const file = fileFor(id);
  if (file.exists) file.delete();
}

export async function exportCv(cv: Cv): Promise<void> {
  const name = cv.name.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 60) || 'CV';
  const file = new File(Paths.cache, `${name}-CV.pdf`);
  if (file.exists) file.delete();
  const pdf = renderCvPdf(cv, TEMPLATES[cv.template]);
  file.write(Uint8Array.from(pdf, (ch) => ch.charCodeAt(0)));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Share CV' });
}
