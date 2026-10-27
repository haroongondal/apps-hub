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

// Expo CLI's Metro server root is the workspace root in a monorepo, so a
// plain dev request (`/index.bundle`, the only kind a bare debug build
// without expo-dev-client sends) resolves `index` against the workspace
// root and 500s. Route it to this app's entry, relative to that root.
const appRelativeRoot = path.relative(monorepoRoot, projectRoot);
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    if (typeof req.url === 'string' && req.url.startsWith('/index.')) {
      req.url = `/${appRelativeRoot}${req.url}`;
    }
    return middleware(req, res, next);
  },
};

module.exports = config;
