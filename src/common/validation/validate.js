'use strict';

const { z } = require('zod');
const { ValidationError } = require('../errors/AppError');

/**
 * Validates req.body / req.params / req.query against a Zod schema.
 * Returns a middleware. On failure throws ValidationError with structured details.
 *
 * @param {z.ZodTypeAny} schema
 * @param {'body'|'params'|'query'} [source='body']
 */
function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
        code: e.code,
      }));
      throw new ValidationError(`Invalid ${source}`, { errors: details });
    }
    // Replace with parsed/coerced data
    req[source] = result.data;
    next();
  };
}

/**
 * Validates multiple sources at once.
 * @param {{ body?: z.ZodTypeAny, params?: z.ZodTypeAny, query?: z.ZodTypeAny }} schemas
 */
function validateAll(schemas) {
  return (req, _res, next) => {
    const allErrors = [];

    for (const [source, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(req[source]);
      if (!result.success) {
        result.error.errors.forEach((e) => {
          allErrors.push({ source, path: e.path.join('.'), message: e.message, code: e.code });
        });
      } else {
        req[source] = result.data;
      }
    }

    if (allErrors.length > 0) {
      throw new ValidationError('Request validation failed', { errors: allErrors });
    }
    next();
  };
}

module.exports = { validate, validateAll };
