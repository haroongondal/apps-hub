/** Where Nexus kept the Gemini and Groq keys before AI hub became its only AI. */
export const OLD_KEY_NAMES = ['gemini-api-keys', 'groq-api-keys', 'gemini-api-key', 'groq-api-key'] as const;

export interface OldKeyStore {
  remove(name: string): Promise<void>;
  /** A small marker that a hub call has worked on this phone; it survives restarts. */
  marked(): Promise<boolean>;
  mark(): Promise<void>;
}

/**
 * The keys now live in AI hub's vault. Delete them only after the first SUCCESSFUL hub call (a chat or embed that
 * returned a real result): that proves the hub holds a key, and deleting earlier could leave the owner with none anywhere.
 * `available()` alone, or any hub error (not allowed, no key, busy, offline, empty reply), never counts.
 * `worked` marks the phone and deletes; `start` finishes the deletion on a later start while the marker exists.
 */
export function oldKeyCleanup({ remove, marked, mark }: OldKeyStore) {
  let done = false;
  const clear = async () => {
    if (done) return;
    for (const name of OLD_KEY_NAMES) await remove(name);
    done = true;
  };
  return {
    async worked(): Promise<void> {
      if (done) return;
      if (!(await marked())) await mark();
      await clear();
    },
    async start(): Promise<void> {
      if (await marked()) await clear();
    },
  };
}
