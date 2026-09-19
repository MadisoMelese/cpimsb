'use strict';

module.exports = async function globalSetup() {
  process.env.NODE_ENV = 'test';
  // Run migrations only when a test DB URL is explicitly provided
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { execSync } = require('child_process');
    try {
      execSync('npx prisma migrate deploy', {
        stdio: 'pipe',
        env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
      });
      console.log('[test setup] Migrations applied');
    } catch (e) {
      console.warn('[test setup] Migration warning:', e.stderr?.toString());
    }
  }
};
