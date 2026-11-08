// One lock for every read-modify-write of `settings`, `myRules`, `myRuleSources` and `myCosmetic`. Web Locks are shared by
// the worker, the menu and the settings page; Node (the unit tests) has none, so there it is a promise chain in this process.
let chain: Promise<unknown> = Promise.resolve();

export async function withSettingsLock<T>(work: () => Promise<T>): Promise<T> {
  if (globalThis.navigator?.locks) return await navigator.locks.request('sieve-settings', work);
  const run = chain.then(work);
  chain = run.catch(() => {});
  return run;
}
