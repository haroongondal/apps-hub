// Monorepo-aware Metro: hoisted linker puts shared deps at the workspace root.
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
