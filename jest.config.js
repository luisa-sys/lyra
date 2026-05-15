/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx)$': ['@swc/jest'],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // KAN-180: ignore agent-sandbox worktrees + build output so a local
  // `npm test` doesn't double-run every test from each worktree
  // snapshot. CI never sees `.claude/`; this is purely a local-DX fix.
  testPathIgnorePatterns: ['/node_modules/', '/\\.claude/', '/\\.next/'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
  },
};

module.exports = config;
