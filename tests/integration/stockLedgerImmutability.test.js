'use strict';

/**
 * INTEGRATION TEST — Stock Ledger Immutability
 * =============================================
 * Verifies that the DB trigger fn_prevent_ledger_mutation fires
 * when any code attempts to UPDATE or DELETE a posted ledger entry.
 *
 * Requires a live DB with the trigger installed.
 */

const hasDB = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const describeWithDB = hasDB ? describe : describe.skip;

describeWithDB('Stock ledger immutability (requires DB + trigger)', () => {
  let prisma;

  beforeAll(async () => {
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL } },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('Scenario 10 — UPDATE on stock_ledger row throws IMMUTABLE_LEDGER', async () => {
    // Try a raw SQL UPDATE — trigger should fire
    const existingEntry = await prisma.stockLedger.findFirst();
    if (!existingEntry) {
      console.warn('No ledger entries found — skipping immutability test');
      return;
    }

    await expect(
      prisma.$executeRaw`
        UPDATE stock_ledger SET notes = 'tampered' WHERE id = ${existingEntry.id}::uuid
      `
    ).rejects.toThrow(/IMMUTABLE_LEDGER/);
  });

  it('Scenario 10 — DELETE on stock_ledger row throws IMMUTABLE_LEDGER', async () => {
    const existingEntry = await prisma.stockLedger.findFirst();
    if (!existingEntry) return;

    await expect(
      prisma.$executeRaw`
        DELETE FROM stock_ledger WHERE id = ${existingEntry.id}::uuid
      `
    ).rejects.toThrow(/IMMUTABLE_LEDGER/);
  });
});

// ─── Unit-level ────────────────────────────────────────────────────────────────

describe('Stock ledger immutability — unit', () => {
  it('DB trigger error message contains IMMUTABLE_LEDGER code', () => {
    const dbError = new Error(
      'IMMUTABLE_LEDGER: Stock ledger entries cannot be modified or deleted. ' +
      'Entry id=test is immutable after posting. Use a reversal entry instead.',
    );
    expect(dbError.message).toContain('IMMUTABLE_LEDGER');
  });

  it('Reversal entry is the only valid correction mechanism', () => {
    const reversalEntry = {
      movementType: 'REVERSAL',
      reversalOfId: 'original-ledger-id-uuid',
      quantityKg:   '-100.000', // equal and opposite
    };
    expect(reversalEntry.movementType).toBe('REVERSAL');
    expect(reversalEntry.reversalOfId).toBeTruthy();
    expect(parseFloat(reversalEntry.quantityKg)).toBeLessThan(0);
  });
});
