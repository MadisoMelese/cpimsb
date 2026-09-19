'use strict';

/**
 * Applies manual SQL constraints, triggers, and functions.
 * Run once after prisma migrate: node src/database/applyMigrations.js
 *
 * Handles dollar-quoted PL/pgSQL blocks correctly by not splitting on ;
 * inside $$ ... $$ sections.
 */

const { PrismaClient } = require('@prisma/client');
const fs   = require('fs');
const path = require('path');

const prisma = new PrismaClient();

/**
 * Split SQL into individual statements while respecting:
 * - dollar-quoted strings ($$...$$)
 * - single-line comments (--)
 * - semicolons only at the top level (not inside $$ blocks)
 */
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let inDollarQuote = false;
  let dollarTag = '';
  let i = 0;

  while (i < sql.length) {
    // Check for start/end of dollar-quote
    if (!inDollarQuote) {
      // Try to match a dollar-quote opener like $$ or $tag$
      const dollarMatch = sql.slice(i).match(/^(\$[A-Za-z0-9_]*\$)/);
      if (dollarMatch) {
        dollarTag = dollarMatch[1];
        inDollarQuote = true;
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }

      // Skip single-line comments
      if (sql[i] === '-' && sql[i + 1] === '-') {
        while (i < sql.length && sql[i] !== '\n') i++;
        continue;
      }

      // Statement terminator
      if (sql[i] === ';') {
        const stmt = current.trim();
        if (stmt.length > 0) statements.push(stmt);
        current = '';
        i++;
        continue;
      }
    } else {
      // Inside a dollar-quoted block — look for the closing tag
      if (sql.slice(i).startsWith(dollarTag)) {
        current += dollarTag;
        i += dollarTag.length;
        inDollarQuote = false;
        dollarTag = '';
        continue;
      }
    }

    current += sql[i];
    i++;
  }

  // Catch any trailing statement without a semicolon
  const remaining = current.trim();
  if (remaining.length > 0) statements.push(remaining);

  return statements;
}

async function apply() {
  const sqlFile = path.join(
    __dirname,
    'migrations/manual/001_constraints_triggers_functions.sql',
  );

  const sql = fs.readFileSync(sqlFile, 'utf8');
  const statements = splitStatements(sql).filter((s) => {
    // Skip pure comment blocks and empty
    const trimmed = s.replace(/--[^\n]*/g, '').trim();
    return trimmed.length > 0;
  });

  console.log(`Found ${statements.length} SQL statements to apply...`);

  let applied = 0;
  let skipped = 0;
  let failed  = 0;

  for (const stmt of statements) {
    try {
      await prisma.$executeRawUnsafe(stmt);
      applied++;
    } catch (err) {
      const code = err.meta?.code || err.code || '';
      const msg  = err.message || '';

      // Skip expected "already exists" situations
      if (
        code === '42710' ||   // duplicate_object (trigger/function already exists)
        code === '42P07' ||   // duplicate_table
        code === '42P16' ||   // invalid_table_definition (constraint already exists)
        code === '23505' ||   // unique_violation
        msg.includes('already exists') ||
        msg.includes('duplicate key')
      ) {
        skipped++;
      } else {
        console.error(`\nFAILED (code ${code}):\n${stmt.substring(0, 120)}...\n→ ${msg}\n`);
        failed++;
      }
    }
  }

  console.log(`\nResult: ${applied} applied, ${skipped} skipped (already exist), ${failed} failed`);

  if (failed > 0) {
    console.log('\nSome statements failed — check output above.');
    process.exit(1);
  } else {
    console.log('✓ All constraints, triggers, and functions applied successfully.');
  }
}

apply()
  .catch((err) => {
    console.error('Migration runner failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
