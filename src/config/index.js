'use strict';

const dotenv = require('dotenv');
const path = require('path');
const dns = require('node:dns/promises');
dns.setServers(['8.8.8.8', '1.1.1.1']);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Reads a required environment variable. Throws at startup if missing.
 */
function required(key) {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key, fallback) {
  return process.env[key] ?? fallback;
}

function requiredInt(key) {
  const raw = required(key);
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) throw new Error(`Environment variable ${key} must be an integer, got: ${raw}`);
  return parsed;
}

function optionalInt(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) throw new Error(`Environment variable ${key} must be an integer, got: ${raw}`);
  return parsed;
}

const config = {
  env: optional('NODE_ENV', 'development'),
  port: optionalInt('PORT', 4000),
  apiPrefix: optional('API_PREFIX', '/api'),

  db: {
    url: required('DATABASE_URL'),
  },

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    accessExpiresIn: optional('JWT_ACCESS_EXPIRES_IN', '15m'),
    refreshExpiresIn: optional('JWT_REFRESH_EXPIRES_IN', '7d'),
  },

  rateLimit: {
    windowMs: optionalInt('RATE_LIMIT_WINDOW_MS', 900_000),
    max: optionalInt('RATE_LIMIT_MAX', 200),
  },

  log: {
    level: optional('LOG_LEVEL', 'info'),
  },

  cors: {
    origins: optional('CORS_ORIGINS', 'http://localhost:3000')
      .split(',')
      .map((s) => s.trim()),
  },

  processing: {
    lossMinPct: optionalInt('PROCESSING_LOSS_MIN_PCT', 0),
    lossMaxPct: optionalInt('PROCESSING_LOSS_MAX_PCT', 30),
  },

  isDev: optional('NODE_ENV', 'development') === 'development',
  isProd: optional('NODE_ENV', 'development') === 'production',
};

module.exports = config;
