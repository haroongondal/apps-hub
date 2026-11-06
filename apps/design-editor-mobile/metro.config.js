// Workspace-aware Metro: pick up hoisted modules from the monorepo root.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [...new Set([...(config.watchFolders ?? []), monorepoRoot])];
config.resolver.nodeModulesPaths = [
  path.resolve(monorepoRoot, 'node_modules'),
  ...(config.resolver.nodeModulesPaths ?? []),
];
module.exports = config;
