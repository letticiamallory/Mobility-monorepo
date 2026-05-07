const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { resolve: metroResolve } = require('metro-resolver');

const config = getDefaultConfig(__dirname);

config.transformer.babelTransformerPath = require.resolve('react-native-svg-transformer');
config.resolver.assetExts = config.resolver.assetExts.filter(ext => ext !== 'svg');
config.resolver.sourceExts = [...config.resolver.sourceExts, 'svg'];

const mapsWebStub = path.resolve(__dirname, 'react-native-maps.web.tsx');
const previousResolveRequest = config.resolver.resolveRequest;

function isWebPlatform(platform, context) {
  return (
    platform === 'web' ||
    context?.platform === 'web' ||
    context?.unstable_conditionNames?.includes?.('web') === true
  );
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (isWebPlatform(platform, context) && moduleName === 'react-native-maps') {
    return { type: 'sourceFile', filePath: mapsWebStub };
  }
  if (typeof previousResolveRequest === 'function') {
    return previousResolveRequest(context, moduleName, platform);
  }
  if (typeof context.resolveRequest === 'function') {
    return context.resolveRequest(context, moduleName, platform);
  }
  return metroResolve(context, moduleName, platform);
};

module.exports = config;