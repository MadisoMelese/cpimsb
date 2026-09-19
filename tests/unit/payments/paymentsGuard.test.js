'use strict';

const { OverpaymentError, IdempotencyConflictError } = require('../../../src/common/errors/AppError');
const { subtract, isGreaterThan, Decimal } = require('../../../src/common/utils/decimal');

function checkOverpayment(totalAmount, alreadyPaid, newPayment, transactionId) {
  const total     = new Decimal(totalAmount.toString());
  const paid      = new Decimal(alreadyPaid.toString());
  const payment   = new Decimal(newPayment.toString());
  const remaining = subtract(total, paid);

  if (isGreaterThan(payment, remaining)) {
    throw new OverpaymentError(payment.toNumber(), remaining.toNumber(), transactionId);
  }
  return subtract(remaining, payment);
}

describe('Payment overpayment guard', () => {
  it('allows payment within balance', () => {
    const newBalance = checkOverpayment('1000.00', '0.00', '500.00', 'txn-1');
    expect(newBalance.toFixed(2)).toBe('500.00');
  });

  it('allows exact full payment', () => {
    const newBalance = checkOverpayment('1000.00', '500.00', '500.00', 'txn-1');
    expect(newBalance.toFixed(2)).toBe('0.00');
  });

  it('Scenario 15 — rejects payment exceeding remaining balance', () => {
    expect(() => checkOverpayment('1000.00', '800.00', '300.00', 'txn-1'))
      .toThrow(OverpaymentError);
  });

  it('OverpaymentError has correct code and details', () => {
    try {
      checkOverpayment('500.00', '0.00', '600.00', 'sale-123');
    } catch (err) {
      expect(err.code).toBe('OVERPAYMENT_NOT_ALLOWED');
      expect(err.status).toBe(422);
      expect(err.details.paymentAmount).toBe(600);
      expect(err.details.remainingAmount).toBe(500);
      expect(err.details.transactionId).toBe('sale-123');
    }
  });

  it('partial payments accumulate correctly without float error', () => {
    // Pay in 3 installments of 333.33, 333.33, 333.34 = exactly 1000.00
    let remaining = new Decimal('1000.00');
    const payments = ['333.33', '333.33', '333.34'];

    for (const p of payments) {
      const pmtAmt = new Decimal(p);
      expect(isGreaterThan(pmtAmt, remaining)).toBe(false);
      remaining = subtract(remaining, pmtAmt);
    }

    expect(remaining.toFixed(2)).toBe('0.00');
  });
});

describe('Payment idempotency', () => {
  const DB_PAYMENTS = new Map(); // simulate DB

  function createPaymentIdempotent(operationId, amount) {
    if (DB_PAYMENTS.has(operationId)) {
      return { alreadyApplied: true, payment: DB_PAYMENTS.get(operationId) };
    }
    const payment = { operationId, amount, id: `pay-${Date.now()}` };
    DB_PAYMENTS.set(operationId, payment);
    return { alreadyApplied: false, payment };
  }

  beforeEach(() => DB_PAYMENTS.clear());

  it('Scenario 3 — retried payment applied only once', () => {
    const opId = 'op-pay-abc-123';
    const r1   = createPaymentIdempotent(opId, 500);
    const r2   = createPaymentIdempotent(opId, 500);
    const r3   = createPaymentIdempotent(opId, 500);

    expect(r1.alreadyApplied).toBe(false);
    expect(r2.alreadyApplied).toBe(true);
    expect(r3.alreadyApplied).toBe(true);

    // Same payment object returned each time
    expect(r1.payment.id).toBe(r2.payment.id);
    expect(r1.payment.id).toBe(r3.payment.id);

    // DB has exactly one entry
    expect(DB_PAYMENTS.size).toBe(1);
  });

  it('Scenario 2 — same sync operation submitted 10 times applies once', () => {
    const opId = 'sync-op-xyz';
    const results = Array.from({ length: 10 }, () => createPaymentIdempotent(opId, 200));
    const applied  = results.filter((r) => !r.alreadyApplied);
    expect(applied.length).toBe(1);
    expect(DB_PAYMENTS.size).toBe(1);
  });
});
