// ABOUTME: Jest config for the opt-in end-to-end suite (real fetch, real console, live site)
// ABOUTME: Run with RUN_E2E=1 npm run test:e2e; never used by CI or the pre-commit hook
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/e2e/**/*.e2e.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  testTimeout: 120000
};
