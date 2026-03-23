/**
 * Jest Configuration for Content Agency OS
 * Minimal working config — add extras only after required packages exist
 */

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tmp/', '<rootDir>/data/', '<rootDir>/dashboard/'],
  collectCoverage: true,
  coverageDirectory: './coverage',
  coverageReporters: ['text', 'text-summary'],
  collectCoverageFrom: [
    'utils/**/*.js',
    'orchestrator.js',
    'scheduler.js',
    '!**/node_modules/**',
    '!**/tests/**'
  ],
  testTimeout: 30000,
  verbose: true,
  clearMocks: true,
  restoreMocks: true
};
