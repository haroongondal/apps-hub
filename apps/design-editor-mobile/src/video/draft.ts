import { emptyProject, parseDraft, type Project } from '@apps-hub/media-core';

export const droppedNote = (n: number) =>
  n === 1 ? '1 file could not be opened and was taken out of the video.' : `${n} files could not be opened and were taken out of the video.`;

// A picked file may be deleted or its access gone; its clips and music are dropped so Save never starts a doomed job.
// dropped counts files, not pieces: one cut clip is several pieces of one file.
export async function dropUnreadable(project: Project, readable: (uri: string) => Promise<boolean>): Promise<{ project: Project; dropped: number }> {
  const uris = [...new Set([...project.clips, ...project.music].map(x => x.source.uri))];
  const ok = await Promise.all(uris.map(u => readable(u).catch(() => false)));
  const gone = new Set(uris.filter((_, i) => !ok[i]));
  if (!gone.size) return { project, dropped: 0 };
  const kept = <T extends { source: { uri: string } }>(xs: T[]) => xs.filter(x => !gone.has(x.source.uri));
  return { project: { ...project, clips: kept(project.clips), music: kept(project.music) }, dropped: gone.size };
}

export const restoreDraft = (text: string | undefined, readable: (uri: string) => Promise<boolean>) =>
  dropUnreadable((text && parseDraft(text)) || emptyProject(), readable);

export function queued<A>(run: (a: A) => Promise<void>): (a: A) => Promise<void> {
  let last: Promise<unknown> = Promise.resolve();
  return a => {
    const next = last.then(() => run(a), () => run(a));
    last = next;
    return next;
  };
}
