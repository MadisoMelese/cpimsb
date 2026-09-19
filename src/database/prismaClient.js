'use strict';

const { PrismaClient } = require('@prisma/client');
const logger = require('../common/logger');

/**
 * Singleton Prisma client.
 * Logs slow queries in development.
 */
const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === 'development'
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ]
      : [
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ],
});

if (process.env.NODE_ENV === 'development') {
  prisma.$on('query', (e) => {
    if (e.duration > 500) {
      logger.warn({ duration: e.duration, query: e.query }, 'Slow query detected');
    }
  });
}

prisma.$on('warn',  (e) => logger.warn(e, 'Prisma warning'));
prisma.$on('error', (e) => logger.error(e, 'Prisma error'));

module.exports = prisma;
