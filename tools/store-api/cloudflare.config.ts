import { bindings, defineConfig } from 'cf/config';

export default defineConfig({
  // Personal account (cf profile "personal"); never the work account.
  accountId: '29ada9205500ff7931f09084daf89597',
  worker: {
    name: 'apps-hub-store',
    entrypoint: './src/index.ts',
    compatibilityDate: '2026-10-01',
    env: {
      BUCKET: bindings.r2({ name: 'apps-hub-store' }),
      STORE_TOKEN: bindings.secret(),
      RELEASE_TOKEN: bindings.secret(),
      SIGNING_KEY: bindings.secret(),
    },
  },
});
