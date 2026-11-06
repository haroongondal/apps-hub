declare const __SYNC_URL__: string | undefined;
// The vault-api Worker; the phone's SyncConfig.BASE_URL is the same address (build.test.ts checks). build.mjs defines __SYNC_URL__ from STRONGROOM_SYNC_URL for the e2e ('' builds without sync).
export const SYNC_URL: string = typeof __SYNC_URL__ === 'string' ? __SYNC_URL__ : 'https://strongroom-vault.haroonmukhtar4.workers.dev';
