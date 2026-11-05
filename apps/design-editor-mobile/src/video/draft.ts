import { emptyProject, parseDraft, type Project } from '@apps-hub/media-core';

export const droppedNote = (n: number) =>
  n === 1 ? '1 clip could not be opened and was removed.' : `${n} clips could not be opened and were removed.`;

// A picked file may be deleted or its access gone; such clips are dropped so Save never starts a doomed job.
export async function dropUnreadable(project: Project, readable: (uri: string) => Promise<boolean>): Promise<{ project: Project; dropped: number }> {
  const uris = [...new Set(project.clips.map(c => c.source.uri))];
  const ok = await Promise.all(uris.map(u => readable(u).catch(() => false)));
  const gone = new Set(uris.filter((_, i) => !ok[i]));
  const clips = project.clips.filter(c => !gone.has(c.source.uri));
  return { project: gone.size ? { ...project, clips } : project, dropped: project.clips.length - clips.length };
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
