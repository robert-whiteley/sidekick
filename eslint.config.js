const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = defineConfig([
  expoConfig,
  eslintPluginPrettierRecommended,
  { ignores: ['dist/*', 'android/*', 'ios/*', 'coverage/*', '.claude/*'] },
  {
    // Navigation goes through Expo Router.
    files: ['src/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@react-navigation/*'],
              message: 'Use expo-router (Link, router, useLocalSearchParams) instead.',
            },
          ],
        },
      ],
    },
  },
]);
