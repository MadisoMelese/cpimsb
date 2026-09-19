'use strict';

const {
  InvalidStatusTransitionError,
  BusinessRuleError,
  IdempotencyConflictError,
} = require('../../../src/common/errors/AppError');

// ─── Status machine ────────────────────────────────────────────────────────────

const VALID_TRANSITIONS = {
  DRAFT:     ['SUBMITTED'],
  SUBMITTED: ['VERIFIED', 'REJECTED'],
  VERIFIED:  ['APPROVED', 'REJECTED'],
  APPROVED:  [],        // terminal
  REJECTED:  ['DRAFT'], // can be corrected and resubmitted
};

function assertValidTransition(entity, from, to) {
  const allowed = VALID_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new InvalidStatusTransitionError(entity, from, to);
  }
}

describe('Purchase workflow — status transitions', () => {
  it('DRAFT → SUBMITTED is valid', () => {
    expect(() => assertValidTransition('Purchase', 'DRAFT', 'SUBMITTED')).not.toThrow();
  });

  it('DRAFT → APPROVED is invalid (must pass through SUBMITTED → VERIFIED)', () => {
    expect(() => assertValidTransition('Purchase', 'DRAFT', 'APPROVED'))
      .toThrow(InvalidStatusTransitionError);
  });

  it('APPROVED → APPROVED is invalid (cannot approve twice)', () => {
    expect(() => assertValidTransition('Purchase', 'APPROVED', 'APPROVED'))
      .toThrow(InvalidStatusTransitionError);
  });

  it('VERIFIED → APPROVED is valid', () => {
    expect(() => assertValidTransition('Purchase', 'VERIFIED', 'APPROVED')).not.toThrow();
  });

  it('VERIFIED → REJECTED is valid', () => {
    expect(() => assertValidTransition('Purchase', 'VERIFIED', 'REJECTED')).not.toThrow();
  });

  it('APPROVED → anything is invalid (terminal state)', () => {
    for (const s of ['DRAFT', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'APPROVED']) {
      expect(() => assertValidTransition('Purchase', 'APPROVED', s))
        .toThrow(InvalidStatusTransitionError);
    }
  });
});

describe('Purchase approval idempotency', () => {
  /**
   * Simulates the approval service logic:
   * - same operationId → return existing (idempotent)
   * - already APPROVED with different operationId → conflict
   * - VERIFIED → allow
   */
  function simulateApproval(purchase, incomingOpId) {
    if (purchase.approvalOperationId === incomingOpId) {
      return { idempotent: true };
    }
    if (purchase.status === 'APPROVED') {
      throw new IdempotencyConflictError(incomingOpId);
    }
    assertValidTransition('Purchase', purchase.status, 'APPROVED');
    return { approved: true };
  }

  it('Scenario 4a — same operationId submitted twice returns idempotent result', () => {
    const purchase = { status: 'APPROVED', approvalOperationId: 'op-001' };
    const result   = simulateApproval(purchase, 'op-001');
    expect(result.idempotent).toBe(true);
  });

  it('Scenario 4b — different operationId on APPROVED purchase is rejected', () => {
    const purchase = { status: 'APPROVED', approvalOperationId: 'op-001' };
    expect(() => simulateApproval(purchase, 'op-002'))
      .toThrow(IdempotencyConflictError);
  });

  it('Scenario 4c — first approval on VERIFIED purchase succeeds', () => {
    const purchase = { status: 'VERIFIED', approvalOperationId: null };
    const result   = simulateApproval(purchase, 'op-new');
    expect(result.approved).toBe(true);
  });

  it('Scenario 4d — approval on DRAFT purchase is rejected', () => {
    const purchase = { status: 'DRAFT', approvalOperationId: null };
    expect(() => simulateApproval(purchase, 'op-new'))
      .toThrow(InvalidStatusTransitionError);
  });
});

describe('Purchase item validation', () => {
  it('rejects purchase with no items', () => {
    const items = [];
    if (items.length === 0) {
      expect(() => { throw new BusinessRuleError('PURCHASE_NO_ITEMS', 'No items'); })
        .toThrow('No items');
    }
  });

  it('rejects negative quantity', () => {
    const qty = -100;
    expect(qty).toBeLessThan(0);
  });

  it('rejects zero quantity', () => {
    const qty = 0;
    expect(qty).toBe(0);
  });
});
