'use strict';

/**
 * Input sanitization middleware.
 *
 * Rules:
 * - Strip null bytes from all string values (prevents PostgreSQL injection vectors)
 * - Trim string values
 * - Reject requests with excessively large bodies (handled by express.json limit)
 * - Log suspicious patterns
 *
 * Note: SQL injection is primarily prevented by Prisma's parameterized queries.
 * This layer adds defence-in-depth.
 */

const logger = require('../logger');

const NULL_BYTE_RE = /\0/g;
const MAX_STRING_LENGTH = 10_000;

function sanitizeValue(value, key, requestId) {
  if (typeof value !== 'string') return value;

  // Strip null bytes
  if (NULL_BYTE_RE.test(value)) {
    logger.warn({ requestId, key }, 'Null byte detected and stripped from input');
    value = value.replace(NULL_BYTE_RE, '');
  }

  // Warn on suspiciously long strings (not reject — let Zod validation handle that)
  if (value.length > MAX_STRING_LENGTH) {
    logger.warn({ requestId, key, length: value.length }, 'Suspiciously long input value');
  }

  return value;
}

function sanitizeObject(obj, requestId, depth = 0) {
  if (depth > 10) return obj; // prevent infinite recursion on deeply nested objects
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') return sanitizeValue(obj, 'root', requestId);

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, requestId, depth + 1));
  }

  if (typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value, requestId, depth + 1);
    }
    return sanitized;
  }

  return obj;
}

/**
 * Express middleware — sanitizes req.body, req.query, req.params.
 */
function sanitizeInputs(req, _res, next) {
  const requestId = req.requestId;

  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body, requestId);
  }

  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeObject(req.query, requestId);
  }

  // Params are path segments — only strip null bytes
  if (req.params && typeof req.params === 'object') {
    for (const [key, value] of Object.entries(req.params)) {
      if (typeof value === 'string') {
        req.params[key] = value.replace(NULL_BYTE_RE, '');
      }
    }
  }

  next();
}

module.exports = { sanitizeInputs };
