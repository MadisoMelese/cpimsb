'use strict';

const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const config     = require('../../config');

// ─── Helmet — secure HTTP headers ─────────────────────────────────────────────

const helmetMiddleware = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],   // swagger-ui needs inline styles
      imgSrc:      ["'self'", 'data:'],
      connectSrc:  ["'self'"],
      fontSrc:     ["'self'"],
      objectSrc:   ["'none'"],
      frameSrc:    ["'none'"],
      baseUri:     ["'self'"],
      formAction:  ["'self'"],
      upgradeInsecureRequests: [],
    },
  },

  // Prevents clickjacking
  frameguard: { action: 'deny' },

  // Disable browser MIME sniffing
  noSniff: true,

  // XSS Filter (legacy header, belt-and-suspenders)
  xssFilter: true,

  // Remove X-Powered-By: Express
  hidePoweredBy: true,

  // HSTS — only in production
  hsts: config.isProd
    ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
    : false,

  // Referrer policy
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

  // Permissions policy — disable sensors/geolocation
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },

  crossOriginEmbedderPolicy: false,   // required for Swagger UI
  crossOriginResourcePolicy: { policy: 'same-origin' },
});

// ─── Global rate limiter ───────────────────────────────────────────────────────

const globalRateLimiter = rateLimit({
  windowMs:        config.rateLimit.windowMs,
  max:             config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => req.ip,
  skip: (req) => req.path === '/health',
  message: {
    success: false,
    error: {
      code:    'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please slow down.',
      details: {},
    },
  },
  handler: (req, res, _next, options) => {
    res.status(options.statusCode).json(options.message);
  },
});

// ─── Strict auth rate limiter — login endpoint ────────────────────────────────

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,   // 15 minutes
  max:      20,                  // 20 login attempts per 15 min
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => req.ip,
  message: {
    success: false,
    error: {
      code:    'AUTH_RATE_LIMIT_EXCEEDED',
      message: 'Too many login attempts. Please try again in 15 minutes.',
      details: {},
    },
  },
});

// ─── Mutation rate limiter — approval/payment/sync endpoints ──────────────────

const mutationRateLimiter = rateLimit({
  windowMs: 60 * 1_000,   // 1 minute
  max:      60,            // 60 mutations per minute per IP
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => `${req.ip}:${req.user?.id || 'anon'}`,
  message: {
    success: false,
    error: {
      code:    'MUTATION_RATE_LIMIT_EXCEEDED',
      message: 'Too many write operations. Please slow down.',
      details: {},
    },
  },
});

// ─── Sync push rate limiter ───────────────────────────────────────────────────

const syncRateLimiter = rateLimit({
  windowMs: 60 * 1_000,   // 1 minute
  max:      30,            // 30 sync pushes per minute per device
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => req.headers['x-device-id'] || req.ip,
  message: {
    success: false,
    error: {
      code:    'SYNC_RATE_LIMIT_EXCEEDED',
      message: 'Sync rate limit exceeded. Please wait before retrying.',
      details: {},
    },
  },
});

module.exports = {
  helmetMiddleware,
  globalRateLimiter,
  authRateLimiter,
  mutationRateLimiter,
  syncRateLimiter,
};
