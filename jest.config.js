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
    // KAN-414 F6: generated Supabase schemas. 6,971 lines of pure type
    // declarations that erase at build time, so they contain nothing
    // executable to cover — including them would dilute every percentage
    // below by roughly a third and make the floor meaningless.
    '!src/types/database/*.ts',
  ],
  // KAN-414 F5 — a real floor, replacing four zeroes.
  //
  // A threshold of 0 cannot detect anything: coverage could fall to nothing and
  // CI would stay green, which is the same class of defect as a test floor
  // recorded years below reality (KAN-435) or a guard that passes vacuously
  // (SEC-111). Measured 2026-07-29 on `develop` via
  //   npx jest --testPathPatterns='tests/(unit|scripts)' --coverage
  // giving statements 47.65% / branches 39.08% / functions 34.09% /
  // lines 48.89%.
  //
  // Set ~2-3 points below measured, deliberately. Tight enough that deleting a
  // meaningful body of tests goes red; loose enough that ordinary churn does
  // not, because a floor that fails on unrelated work is one people raise the
  // ceiling on rather than investigate.
  //
  // This is a RATCHET: when coverage rises, raise these. It may not be lowered
  // to make a red build pass — that is the Test Integrity Policy, and lowering
  // it is indistinguishable from deleting the tests it was protecting.
  //
  // Per-module thresholds are F5's remaining scope and depend on F4's test
  // decoupling: today a source-text test for module A can live in a file named
  // after module B, so a per-path threshold would measure the wrong thing.
  coverageThreshold: {
    global: {
      branches: 37,
      functions: 32,
      lines: 46,
      statements: 45,
    },
  },
};

module.exports = config;
