'use strict';

/**
 * Unit tests for the inventory engine logic.
 * These run without a database — we mock the Prisma transaction client.
 */

const { InsufficientStockError, BusinessRuleError } = require('../../../src/common/errors/AppError');
const { isGreaterThan, subtract, Decimal } = require('../../../src/common/utils/decimal');

// ─── Helper: simulate consumeFromBatch guard logic ────────────────────────────

function checkSufficientStock(remainingKg, requestedKg, batchId) {
  const remaining = new Decimal(remainingKg.toString());
  const requested = new Decimal(requestedKg.toString());
  if (isGreaterThan(requested, remaining)) {
    throw new InsufficientStockError(batchId, requested.toNumber(), remaining.toNumber());
  }
  return subtract(remaining, requested);
}

describe('Inventory Engine — stock guard', () => {
  describe('checkSufficientStock', () => {
    it('allows consumption when requested <= remaining', () => {
      const newBalance = checkSufficientStock('100.000', '80.000', 'batch-1');
      expect(newBalance.toFixed(3)).toBe('20.000');
    });

    it('allows exact consumption (remaining = 0 after)', () => {
      const newBalance = checkSufficientStock('100.000', '100.000', 'batch-1');
      expect(newBalance.toFixed(3)).toBe('0.000');
    });

    it('throws InsufficientStockError when requested > remaining', () => {
      expect(() => checkSufficientStock('100.000', '100.001', 'batch-1'))
        .toThrow(InsufficientStockError);
    });

    it('throws with correct batch and quantity details', () => {
      try {
        checkSufficientStock('50.000', '150.000', 'batch-xyz');
        fail('Should have thrown');
      } catch (err) {
        expect(err.code).toBe('INSUFFICIENT_BATCH_STOCK');
        expect(err.details.batchId).toBe('batch-xyz');
        expect(err.details.requested).toBe(150);
        expect(err.details.available).toBe(50);
        expect(err.status).toBe(422);
      }
    });

    it('never allows negative remaining (floating-point safe)', () => {
      // 0.1 + 0.2 = 0.30000000000000004 in JS floats — must not happen
      const remaining = new Decimal('0.300');
      const requested = new Decimal('0.100').plus(new Decimal('0.200'));
      expect(requested.toFixed(3)).toBe('0.300');
      expect(() => checkSufficientStock(remaining, requested, 'b')).not.toThrow();
    });
  });

  describe('Ledger source integrity guard', () => {
    function validateSources(sources) {
      const nonNull = sources.filter(Boolean);
      if (nonNull.length !== 1) {
        throw new BusinessRuleError(
          'LEDGER_SOURCE_INTEGRITY',
          `Expected exactly 1 source, got ${nonNull.length}`,
        );
      }
    }

    it('accepts exactly one source', () => {
      expect(() => validateSources(['purchase-id', null, null, null, null, null])).not.toThrow();
    });

    it('rejects zero sources', () => {
      expect(() => validateSources([null, null, null, null, null, null]))
        .toThrow('Expected exactly 1 source, got 0');
    });

    it('rejects two sources', () => {
      expect(() => validateSources(['purchase-id', 'sale-id', null, null, null, null]))
        .toThrow('Expected exactly 1 source, got 2');
    });
  });
});
