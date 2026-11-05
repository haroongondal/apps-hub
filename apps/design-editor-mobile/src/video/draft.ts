import { emptyProject, parseDraft, type Project } from '@apps-hub/media-core';

// A file picked last time may be deleted or its access gone; such clips are dropped so Save never starts a doomed job.
export async function restoreDraft(text: string | undefined, readable: (uri: string) => Promise<boolean>): Promise<{ project: Project; dropped: number }> {
  const project = (text && parseDraft(text)) || emptyProject();
  const uris = [...new Set(project.clips.map(c => c.source.uri))];
  const ok = await Promise.all(uris.map(u => readable(u).catch(() => false)));
  const gone = new Set(uris.filter((_, i) => !ok[i]));
  const clips = project.clips.filter(c => !gone.has(c.source.uri));
  return { project: { ...project, clips }, dropped: project.clips.length - clips.length };
}
