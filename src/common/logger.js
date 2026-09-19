'use strict';

const pino = require('pino');
const config = require('../config');

/**
 * Structured logger — every log line is JSON in production, pretty-printed in dev.
 * All critical business operations must log with operationId and requestId
 * so they are traceable from API request to DB transaction.
 */
const logger = pino({
  level: config.log.level,
  ...(config.isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
        },
      }
    : {}),
  base: { service: 'cpims-backend', env: config.env },
  redact: {
    paths: ['req.headers.authorization', 'body.password', 'body.passwordHash', 'body.token'],
    censor: '[REDACTED]',
  },
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err,
  },
});

module.exports = logger;
