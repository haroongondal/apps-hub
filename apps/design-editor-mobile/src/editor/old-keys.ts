// Keys this app saved before it moved to AI hub. They are deleted only after AI hub has returned a real reply to this app
// on this phone (never on "the hub answered", which does not prove it holds a key, and never on a hub error), so the owner
// is never left with a key nowhere: the keys live in the hub's vault and the hub never hands one out.
// A marker file remembers that a reply came, so the deletion finishes on a later start even if the first attempt was cut short.
export type OldKeyDeps = {
  markerExists(): Promise<boolean>;
  writeMarker(): Promise<void>;
  deleteKeyFiles(): Promise<void>;
};

/** A reply worth trusting: some text or a tool call. An empty reply proves nothing about the hub's key. */
export const isRealReply = (r: { text: string | null; toolCalls: unknown[] }) => (r.text ?? '').trim() !== '' || r.toolCalls.length > 0;

/** The hub has just returned a real reply: remember it, then delete the saved keys. */
export async function afterHubReply(deps: OldKeyDeps): Promise<void> {
  await deps.writeMarker();
  await deps.deleteKeyFiles();
}

/** On start: finish the deletion only when a real reply came before. True when the key files were deleted. */
export async function onStart(deps: OldKeyDeps): Promise<boolean> {
  if (!(await deps.markerExists())) return false;
  await deps.deleteKeyFiles();
  return true;
}
