import { bindings, defineConfig, exports as workerExports } from 'cf/config';

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
      MAIL: bindings.sendEmail({ destinationAddress: 'haroonmukhtar4@gmail.com' }),
      PUBLIC_URL: bindings.text('https://strongroom-vault.haroonmukhtar4.workers.dev'),
      LOGIN_GATE: bindings.durableObject({ worker: 'strongroom-vault', exportName: 'LoginGate' }),
      // Hours between approving a new device and it getting the sign-in blob; '24' adds a wait the owner can still deny during.
      SIGNIN_WAIT_HOURS: bindings.text('0'),
    },
    exports: {
      LoginGate: workerExports.durableObject({ storage: 'sqlite' }),
    },
  },
});
