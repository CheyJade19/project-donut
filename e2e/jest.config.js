// End-to-end tests run in plain Node (real fetch, unlike the jest-expo
// preset) against a live PostgREST; see e2e/run.sh.
const babelPresetExpo = require.resolve('babel-preset-expo', { paths: [require.resolve('expo/package.json')] });

module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/e2e/**/*.test.ts'],
  transform: { '\\.[jt]sx?$': ['babel-jest', { presets: [babelPresetExpo], babelrc: false, configFile: false }] },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Only the data code is under test; it never touches native modules.
    '^react-native$': '<rootDir>/e2e/stubs/react-native.js',
  },
};
