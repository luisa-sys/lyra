/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  // Only mutate files that have real functional tests (not file-content checks)
  // Expand this list as more functional tests are added (see KAN-111)
  mutate: [
    'src/app/(auth)/actions.ts',
    'src/lib/sanitise.ts',
  ],
  testRunner: 'jest',
  jest: {
    configFile: 'jest.config.js',
  },
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  reporters: ['clear-text', 'json', 'html'],
  jsonReporter: {
    fileName: 'reports/mutation/mutation-report.json',
  },
  htmlReporter: {
    fileName: 'reports/mutation/index.html',
  },
  thresholds: {
    high: 80,
    low: 60,
    break: null, // Don't fail build yet — too few functional tests
  },
  timeoutMS: 30000,
  concurrency: 2,
};

export default config;
