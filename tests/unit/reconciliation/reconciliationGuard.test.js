'use strict';

const { BusinessRuleError, InvalidStatusTransitionError } = require('../../../src/common/errors/AppError');
const { subtract, Decimal } = require('../../../src/common/utils/decimal');

// ─── Simulated reconciliation close guard ─────────────────────────────────────

function validateCanClose(verifications) {
  for (const v of verifications) {
    const diff = new Decimal(v.differenceKg.toString());
    if (!diff.isZero() && !v.hasAdjustment) {
      throw new BusinessRuleError(
        'UNRESOLVED_RECONCILIATION_DISCREPANCY',
        `Batch ${v.batchId} has unresolved discrepancy of ${diff.toFixed(3)} KG`,
        { batchId: v.batchId, differenceKg: diff.toFixed(3) },
      );
    }
  }
}

describe('Reconciliation — close guard', () => {
  it('allows close when all discrepancies are resolved', () => {
    const verifications = [
      { batchId: 'b1', differenceKg: '-5.000', hasAdjustment: true },
      { batchId: 'b2', differenceKg: '0.000',  hasAdjustment: false },
    ];
    expect(() => validateCanClose(verifications)).not.toThrow();
  });

  it('Scenario 8 — rejects close when discrepancy has no adjustment', () => {
    const verifications = [
      { batchId: 'b1', differenceKg: '-150.000', hasAdjustment: false },
      { batchId: 'b2', differenceKg: '0.000',    hasAdjustment: false },
    ];
    expect(() => validateCanClose(verifications))
      .toThrow(BusinessRuleError);
  });

  it('Scenario 8 — error carries batch and discrepancy details', () => {
    const verifications = [
      { batchId: 'batch-abc', differenceKg: '-75.500', hasAdjustment: false },
    ];
    try {
      validateCanClose(verifications);
    } catch (err) {
      expect(err.code).toBe('UNRESOLVED_RECONCILIATION_DISCREPANCY');
      expect(err.details.batchId).toBe('batch-abc');
      expect(err.details.differenceKg).toBe('-75.500');
    }
  });

  it('allows close when zero discrepancy with no adjustment (nothing to fix)', () => {
    const verifications = [
      { batchId: 'b1', differenceKg: '0.000', hasAdjustment: false },
    ];
    expect(() => validateCanClose(verifications)).not.toThrow();
  });
});

describe('Reconciliation — period locking guard', () => {
  /**
   * Simulates the DB trigger logic that checks locked_periods
   * before allowing a stock ledger insert.
   */
  function checkLockedPeriod(entryDate, lockedPeriods, locationId) {
    const date = new Date(entryDate);
    for (const lp of lockedPeriods) {
      const matchesLocation = !lp.locationId || lp.locationId === locationId;
      const inPeriod = date >= new Date(lp.periodStart) && date <= new Date(lp.periodEnd);
      if (matchesLocation && inPeriod) {
        throw new BusinessRuleError(
          'LOCKED_PERIOD',
          `Cannot post entry for ${entryDate} — period ${lp.periodStart}–${lp.periodEnd} is locked`,
          { entryDate, periodStart: lp.periodStart, periodEnd: lp.periodEnd },
        );
      }
    }
  }

  const lockedPeriods = [
    { locationId: null, periodStart: '2026-09-01', periodEnd: '2026-09-07' },
  ];

  it('Scenario 9 — rejects backdated entry into locked period', () => {
    expect(() => checkLockedPeriod('2026-09-05', lockedPeriods, 'loc-1'))
      .toThrow('LOCKED_PERIOD');
  });

  it('allows entry after locked period ends', () => {
    expect(() => checkLockedPeriod('2026-09-08', lockedPeriods, 'loc-1'))
      .not.toThrow();
  });

  it('allows entry before locked period starts', () => {
    // This would be rejected by a different rule — backdating before a prior period
    // but not locked by THIS session
    expect(() => checkLockedPeriod('2026-08-31', lockedPeriods, 'loc-1'))
      .not.toThrow();
  });

  it('Scenario 9 — error carries period boundaries', () => {
    try {
      checkLockedPeriod('2026-09-03', lockedPeriods, 'loc-1');
    } catch (err) {
      expect(err.code).toBe('LOCKED_PERIOD');
      expect(err.details.periodStart).toBe('2026-09-01');
      expect(err.details.periodEnd).toBe('2026-09-07');
    }
  });
});
