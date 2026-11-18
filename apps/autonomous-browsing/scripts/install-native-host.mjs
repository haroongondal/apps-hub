#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST_NAME = 'com.cd.browser.automation';
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const BROWSER_DIRS = {
  chrome: 'Google/Chrome',
  canary: 'Google/Chrome Canary',
  chromium: 'Chromium',
  edge: 'Microsoft Edge',
  brave: 'BraveSoftware/Brave-Browser',
};

const extensionId = process.argv[2];
const browser = process.argv[3] ?? 'chrome';

if (!extensionId || !/^[a-p]{32}$/.test(extensionId)) {
  console.error(
    'usage: node scripts/install-native-host.mjs <extension-id> [chrome|canary|chromium|edge|brave]'
  );
  console.error(
    '\nThe id is the 32-letter string Chrome shows under the extension on chrome://extensions'
  );
  process.exit(1);
}

const browserDir = BROWSER_DIRS[browser];
if (!browserDir) {
  console.error(
    `unknown browser "${browser}" — expected one of: ${Object.keys(
      BROWSER_DIRS
    ).join(', ')}`
  );
  process.exit(1);
}

const relayPath = path.join(repoRoot, 'native-host', 'relay.js');

if (!existsSync(relayPath)) {
  console.error(`relay not found at ${relayPath}`);
  process.exit(1);
}

// macOS denies Chrome the exec of a host under ~/Documents, reporting only "native host has exited".
const shimDir =
  process.platform === 'darwin'
    ? path.join(homedir(), 'Library', 'Application Support', HOST_NAME)
    : path.join(homedir(), '.local', 'share', HOST_NAME);
mkdirSync(shimDir, { recursive: true });
const shimPath = path.join(shimDir, 'relay-shim.sh');

// Chrome runs native hosts with PATH=/usr/bin:/bin:/usr/sbin:/sbin, so a
// "#!/usr/bin/env node" shebang cannot find a node installed by nvm or
// Homebrew. The shim pins the interpreter this script is running under.
writeFileSync(
  shimPath,
  `#!/bin/sh\nexec "${process.execPath}" "${relayPath}" "$@"\n`
);
chmodSync(shimPath, 0o755);
chmodSync(relayPath, 0o755);

const manifestDir =
  process.platform === 'darwin'
    ? path.join(
        homedir(),
        'Library',
        'Application Support',
        browserDir,
        'NativeMessagingHosts'
      )
    : path.join(
        homedir(),
        '.config',
        browserDir.toLowerCase(),
        'NativeMessagingHosts'
      );

mkdirSync(manifestDir, { recursive: true });

const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);
const manifest = {
  name: HOST_NAME,
  description: 'Outsentia automation control channel',
  path: shimPath,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${extensionId}/`],
};

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`installed  ${manifestPath}`);
console.log(`  host     ${shimPath}`);
console.log(`  node     ${process.execPath}`);
console.log(`  allowed  chrome-extension://${extensionId}/`);
console.log(
  '\nRestart the browser completely (quit, do not just close the window) for it to pick this up.'
);
