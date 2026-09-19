'use strict';

/**
 * Validates all required environment variables at startup.
 * Fails fast with a clear error if any secret is missing or insecure.
 * This prevents the application from starting with dangerous defaults.
 */

const REQUIRED = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
];

const INSECURE_DEFAULTS = [
  'CHANGE_ME',
  'your-secret',
  'secret',
  'password',
  '12345678',
  'changeme',
];

function validateEnv() {
  const errors = [];

  // Check required vars exist
  for (const key of REQUIRED) {
    if (!process.env[key]) {
      errors.push(`Missing required environment variable: ${key}`);
    }
  }

  // Check secrets are not default placeholder values
  const secretKeys = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'DATABASE_URL'];
  for (const key of secretKeys) {
    const value = process.env[key];
    if (!value) continue;

    for (const insecure of INSECURE_DEFAULTS) {
      if (value.toLowerCase().includes(insecure.toLowerCase())) {
        errors.push(
          `Environment variable ${key} appears to use an insecure default value. ` +
          `Change it to a strong random secret before running in production.`,
        );
        break;
      }
    }
  }

  // Check JWT secrets are sufficiently long (min 32 chars)
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    const value = process.env[key];
    if (value && value.length < 32) {
      errors.push(`${key} must be at least 32 characters long (got ${value.length})`);
    }
  }

  // In production, additional checks
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.CORS_ORIGINS || process.env.CORS_ORIGINS.includes('localhost')) {
      errors.push('CORS_ORIGINS must not include localhost in production');
    }
  }

  if (errors.length > 0) {
    const msg = [
      '═══════════════════════════════════════════════════',
      'CPIMS — Environment Configuration Errors:',
      ...errors.map((e) => `  ✗ ${e}`),
      '═══════════════════════════════════════════════════',
    ].join('\n');

    // Only throw in production — warn in development
    if (process.env.NODE_ENV === 'production') {
      throw new Error(msg);
    } else {
      // eslint-disable-next-line no-console
      console.warn(msg);
    }
  }
}

module.exports = { validateEnv };
