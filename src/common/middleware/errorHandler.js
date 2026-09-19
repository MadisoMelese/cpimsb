'use strict';

const { AppError } = require('../errors/AppError');
const logger = require('../logger');

/**
 * Global error handler middleware.
 * Returns a consistent JSON error envelope on every error.
 *
 * Shape:
 * {
 *   "success": false,
 *   "error": {
 *     "code":    "DOMAIN_ERROR_CODE",
 *     "message": "Human-readable message",
 *     "details": {}
 *   },
 *   "requestId": "..."
 * }
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const requestId = req.requestId || 'unknown';

  // Known domain errors
  if (err instanceof AppError) {
    logger.warn(
      { requestId, code: err.code, status: err.status, details: err.details },
      err.message,
    );
    return res.status(err.status).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
      requestId,
    });
  }

  // Prisma unique constraint violation
  if (err.code === 'P2002') {
    logger.warn({ requestId, prismaCode: err.code }, 'Unique constraint violation');
    return res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE_ENTRY',
        message: 'A record with that value already exists.',
        details: { fields: err.meta?.target },
      },
      requestId,
    });
  }

  // Prisma foreign key violation
  if (err.code === 'P2003') {
    logger.warn({ requestId, prismaCode: err.code }, 'Foreign key constraint violation');
    return res.status(422).json({
      success: false,
      error: {
        code: 'FOREIGN_KEY_VIOLATION',
        message: 'Referenced record does not exist.',
        details: { field: err.meta?.field_name },
      },
      requestId,
    });
  }

  // Prisma record not found
  if (err.code === 'P2025') {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Record not found.', details: {} },
      requestId,
    });
  }

  // Postgres check constraint violation (from our custom triggers)
  if (err.code === '23514' || err.code === 'P2010') {
    logger.warn({ requestId, pgCode: err.code }, 'DB check constraint violation');
    return res.status(422).json({
      success: false,
      error: {
        code: 'DATABASE_CONSTRAINT_VIOLATION',
        message: err.message || 'A database constraint was violated.',
        details: {},
      },
      requestId,
    });
  }

  // Unexpected errors — never leak internal details in production
  logger.error({ requestId, err }, 'Unhandled error');

  const isDev = process.env.NODE_ENV === 'development';
  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
      details: isDev ? { stack: err.stack, message: err.message } : {},
    },
    requestId,
  });
}

module.exports = { errorHandler };
