/**
 * Jest Configuration for Content Agency OS Test Suite
 * Configures test execution, coverage, and reporters
 */

module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Root directory for tests
  rootDir: '.',

  // Test match patterns
  testMatch: [
    '**/tests/**/*.test.js',
    '**/?(*.)+(spec|test).js'
  ],

  // Exclude patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tmp/',
    '/data/',
    '/dashboard/'
  ],

  // Coverage settings
  collectCoverage: true,
  collectCoverageFrom: [
    'utils/**/*.js',
    'orchestrator.js',
    'scheduler.js',
    'server.js',
    '!**/node_modules/**',
    '!**/tests/**',
    '!**/tmp/**'
  ],

  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 75,
      lines: 75,
      statements: 75
    },
    './utils/storage.js': {
      branches: 80,
      functions: 90,
      lines: 90,
      statements: 90
    },
    './utils/tokenTracker.js': {
      branches: 80,
      functions: 90,
      lines: 90,
      statements: 90
    },
    './orchestrator.js': {
      branches: 75,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },

  // Coverage directory
  coverageDirectory: './coverage',

  // Coverage reporters
  coverageReporters: [
    'text',
    'text-summary',
    'html',
    'lcov',
    'json'
  ],

  // Test reporters
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: './test-results',
        outputName: 'junit.xml',
        classNameTemplate: '{classname}',
        titleTemplate: '{title}',
        ancestorSeparator: ' › ',
        usePathAsClassName: true
      }
    ]
  ],

  // Timeout for tests
  testTimeout: 30000,

  // Verbose output
  verbose: true,

  // Setup files
  setupFilesAfterEnv: [],

  // Module paths
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@utils/(.*)$': '<rootDir>/utils/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1'
  },

  // Transform files
  transform: {
    '^.+\\.jsx?$': 'babel-jest'
  },

  // Ignore patterns for transforms
  transformIgnorePatterns: [
    'node_modules/(?!(uuid)/)'
  ],

  // Snapshot serializers
  snapshotSerializers: [],

  // Watch plugins
  watchPlugins: [
    'jest-watch-typeahead/filename',
    'jest-watch-typeahead/testname'
  ],

  // Coverage ignore patterns
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tmp/',
    'test',
    'spec'
  ],

  // Test sequencer
  testSequencer: '<rootDir>/jest.sequencer.js',

  // Globals
  globals: {
    'ts-jest': {
      isolatedModules: true
    }
  },

  // Bail on first test failure (useful for development)
  bail: 0,

  // Clear mocks between tests
  clearMocks: true,

  // Restore mocks between tests
  restoreMocks: true,

  // Reset mocks between tests
  resetMocks: true,

  // Reset modules between tests
  resetModules: true,

  // Max workers for parallel test execution
  maxWorkers: '50%',

  // Notify on completion
  notify: true,

  // Slow test threshold in milliseconds
  slowTestThreshold: 10,

  // Error on deprecated APIs
  errorOnDeprecated: true,

  // Preset (if using TypeScript or other presets)
  // preset: 'ts-jest',

  // Module directories
  moduleDirectories: [
    'node_modules',
    'utils'
  ],

  // Cache directory
  cacheDirectory: '.jest-cache',

  // Detect open handles
  detectOpenHandles: false,

  // Force exit
  forceExit: false,

  // Detect leaks
  detectLeaks: false,

  // Environment options
  testEnvironmentOptions: {
    NODE_ENV: 'test'
  }
};
