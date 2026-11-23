// op-sqlite ships its own SQLite (SQLCipher); tell expo-updates not to link a second copy on iOS.
const { withPodfileProperties } = require('expo/config-plugins');

module.exports = function withThirdPartySqlite(config) {
  return withPodfileProperties(config, (c) => {
    c.modResults['expo.updates.useThirdPartySQLitePod'] = 'true';
    return c;
  });
};
