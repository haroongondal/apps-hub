declare const __SYNC_URL__: string | undefined;
// Empty until the Worker is deployed (Task 8). build.mjs defines __SYNC_URL__ from STRONGROOM_SYNC_URL for the e2e; a release build never sets it.
export const SYNC_URL: string = typeof __SYNC_URL__ === 'string' ? __SYNC_URL__ : '';
