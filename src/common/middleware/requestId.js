'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * Attaches a unique requestId to every request.
 * Used for tracing API requests through logs and audit entries.
 */
function requestIdMiddleware(req, res, next) {
  req.requestId = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

module.exports = { requestIdMiddleware };
