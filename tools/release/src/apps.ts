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
  netlens: { name: 'HomeNet', dir: 'apps/netlens', android: { packageName: 'app.netlens' } },
  'open-tunnel': {
    name: 'TunnelWall',
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
  deputy: { name: 'Deputy', dir: 'apps/deputy', android: { packageName: 'com.haroon.deputy' } },
};

/** Release ids of the apps whose workspace-relative dir is in `dirs` (the packages pnpm says changed). */
export function releaseIdsForDirs(dirs: string[]): string[] {
  const changed = new Set(dirs);
  return Object.keys(APPS).filter((id) => changed.has(APPS[id].dir));
}
