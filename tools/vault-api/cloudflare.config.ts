import { bindings, defineConfig } from 'cf/config';

export default defineConfig({
  // Personal account (cf profile "personal"); never the work account.
  accountId: '29ada9205500ff7931f09084daf89597',
  worker: {
    name: 'strongroom-vault',
    entrypoint: './src/index.ts',
    compatibilityDate: '2026-10-01',
    env: {
      DB: bindings.d1({ id: '0dae26b4-869e-4784-a039-022b0326b949', name: 'strongroom-vault' }),
      SETUP_TOKEN: bindings.secret(),
    },
  },
});
