export interface ReleasableApp {
  name: string;
  /** Dir holding app.json and android/: workspace-relative, or absolute for apps outside this repo. */
  dir: string;
  android: { packageName: string };
  prepare?: string[][];
  /** android/ is not committed, so each release regenerates it with `expo prebuild --clean`. */
  prebuild?: boolean;
}

export const APPS: Record<string, ReleasableApp> = {
  netlens: { name: 'NetLens', dir: 'apps/netlens', android: { packageName: 'app.netlens' } },
  'open-tunnel': {
    name: 'OpenTunnel',
    dir: 'apps/open_tunnel_vpn',
    android: { packageName: 'com.opentunnel.open_tunnel_vpn' },
  },
  'pdf-editor': {
    name: 'PDF Editor',
    dir: 'apps/pdf-editor-mobile',
    android: { packageName: 'com.haroon.pdfeditor' },
    prepare: [['node', '../../packages/pdf-editor-engine/build.mjs']],
  },
  store: { name: 'Store', dir: 'apps/store', android: { packageName: 'com.haroon.store' } },
};
