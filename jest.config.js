'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  globalSetup:    '<rootDir>/tests/setup/globalSetup.js',
  globalTeardown: '<rootDir>/tests/setup/globalTeardown.js',
  testTimeout: 30_000,
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/database/seed.js',
    '!src/server.js',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  projects: [
    {
      displayName:     'unit',
      testMatch:       ['<rootDir>/tests/unit/**/*.test.js'],
      testEnvironment: 'node',
    },
    {
      displayName:     'adversarial',
      testMatch:       ['<rootDir>/tests/adversarial/**/*.test.js'],
      testEnvironment: 'node',
    },
    {
      displayName:     'concurrency',
      testMatch:       ['<rootDir>/tests/concurrency/**/*.test.js'],
      testEnvironment: 'node',
    },
    {
      displayName:     'integration',
      testMatch:       ['<rootDir>/tests/integration/**/*.test.js'],
      testEnvironment: 'node',
      runner:          'jest-serial-runner',
    },
  ],
};
