// Keys this app saved before it moved to AI hub. They are deleted only after AI hub has answered once on this phone,
// so the owner is never left with a key nowhere: the keys live in the hub's vault and the hub never hands one out.
export type OldKeyDeps = {
  hub: { available(): Promise<{ ok: boolean }> };
  deleteKeyFiles(): Promise<void>;
};

/** True when the key files were deleted. A hub that is missing, refuses this app or fails leaves them untouched. */
export async function cleanOldKeys(deps: OldKeyDeps): Promise<boolean> {
  const status = await deps.hub.available().catch(() => null);
  if (!status?.ok) return false;
  await deps.deleteKeyFiles();
  return true;
}
