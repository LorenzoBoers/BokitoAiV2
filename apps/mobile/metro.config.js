// Monorepo-aware Metro config (apps/mobile lives inside the bokito-platform workspace).
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

// @bokito/shared source uses NodeNext `.js` specifiers that point at `.ts` files.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const fromShared = context.originModulePath.includes(`${path.sep}packages${path.sep}shared${path.sep}src${path.sep}`)
  if (fromShared && moduleName.endsWith('.js')) {
    return context.resolveRequest(context, moduleName.slice(0, -3), platform)
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
