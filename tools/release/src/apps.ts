import { ANDROID_PACKAGES } from '@apps-hub/store-manifest';

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
  netlens: { name: 'HomeNet', dir: 'apps/netlens', android: { packageName: ANDROID_PACKAGES.netlens } },
  'open-tunnel': {
    name: 'TunnelWall',
    dir: 'apps/open_tunnel_vpn',
    android: { packageName: ANDROID_PACKAGES['open-tunnel'] },
  },
  'pdf-editor': {
    name: 'PDF Editor',
    dir: 'apps/pdf-editor-mobile',
    android: { packageName: ANDROID_PACKAGES['pdf-editor'] },
    prepare: [['node', '../../packages/pdf-editor-engine/build.mjs']],
  },
  'design-editor': {
    name: 'Design Editor',
    dir: 'apps/design-editor-mobile',
    android: { packageName: ANDROID_PACKAGES['design-editor'] },
    // the canvas page inlines itself into assets/editor/editor.html before a build (SPEC §14.1)
    prepare: [['node', '../../packages/design-editor-engine/build.mjs']],
  },
  store: { name: 'Store', dir: 'apps/store', android: { packageName: ANDROID_PACKAGES.store } },
  deputy: { name: 'Deputy', dir: 'apps/deputy', android: { packageName: ANDROID_PACKAGES.deputy } },
  strongroom: { name: 'Strongroom', dir: 'apps/strongroom', android: { packageName: ANDROID_PACKAGES.strongroom } },
};

/** Release ids of the apps whose workspace-relative dir is in `dirs` (the packages pnpm says changed). */
export function releaseIdsForDirs(dirs: string[]): string[] {
  const changed = new Set(dirs);
  return Object.keys(APPS).filter((id) => changed.has(APPS[id].dir));
}
