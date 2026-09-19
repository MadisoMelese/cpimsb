'use strict';

// Validate environment variables before anything else loads
const { validateEnv } = require('./config/validateEnv');
validateEnv();

const app    = require('./app');
const config = require('./config');
const logger = require('./common/logger');
const prisma = require('./database/prismaClient');
const dns = require('node:dns/promises');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const PORT = config.port;

async function main() {
  // Verify DB connection before starting
  try {
    await prisma.$connect();
    logger.info('Database connected');
  } catch (err) {
    logger.error({ err }, 'Failed to connect to database');
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    logger.info({ port: PORT, env: config.env }, `CPIMS backend started on port ${PORT}`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutting down gracefully...');
    server.close(async () => {
      await prisma.$disconnect();
      logger.info('Database disconnected. Goodbye.');
      process.exit(0);
    });
    // Force exit after 10s
    setTimeout(() => process.exit(1), 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught exception — exiting');
    process.exit(1);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
