// Workspace-aware Metro: pick up hoisted modules from the monorepo root and
// let Metro embed the generated editor.html as an asset.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);
config.resolver.assetExts.push('html');
config.watchFolders = [...new Set([...(config.watchFolders ?? []), monorepoRoot])];
config.resolver.nodeModulesPaths = [
  path.resolve(monorepoRoot, 'node_modules'),
  ...(config.resolver.nodeModulesPaths ?? []),
];
// No Node polyfills needed: pdf-lib and PDF.js run inside the WebView, not here.
module.exports = config;
