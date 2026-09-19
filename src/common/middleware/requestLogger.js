'use strict';

const logger = require('../logger');

/**
 * Logs every request with method, url, status, and duration.
 * Binds requestId to the child logger so every log line is traceable.
 */
function requestLogger(req, res, next) {
  const start = Date.now();
  const reqLogger = logger.child({ requestId: req.requestId });
  req.log = reqLogger;

  res.on('finish', () => {
    const duration = Date.now() - start;
    reqLogger.info(
      {
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        durationMs: duration,
        userId: req.user?.id,
      },
      `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`,
    );
  });

  next();
}

module.exports = { requestLogger };
