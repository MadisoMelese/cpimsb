'use strict';

/**
 * CONCURRENCY TESTS — Simulate race conditions
 * =============================================
 * These tests simulate what happens when multiple operations race
 * to consume the same stock simultaneously.
 *
 * The real DB-level enforcement uses SELECT FOR UPDATE in a serializable
 * transaction. These tests verify the application-layer guard logic
 * produces the correct outcomes assuming proper DB locking is in place.
 */

const { InsufficientStockError } = require('../../src/common/errors/AppError');
const { isGreaterThan, subtract, Decimal } = require('../../src/common/utils/decimal');

/**
 * Simulates a serialized concurrent batch consumption.
 * In production this is enforced by PostgreSQL row locking.
 * Here we simulate sequential execution with a shared mutable state.
 */
class MockBatchStore {
  constructor(initialKg) {
    this.remainingKg = new Decimal(initialKg.toString());
    this.lock        = false;
    this.queue       = [];
  }

  async acquireLock() {
    // Simulate sequential lock acquisition
    return new Promise((resolve) => {
      if (!this.lock) {
        this.lock = true;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  releaseLock() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    } else {
      this.lock = false;
    }
  }

  async consume(requestedKg, operationId) {
    await this.acquireLock();
    try {
      const requested = new Decimal(requestedKg.toString());
      if (isGreaterThan(requested, this.remainingKg)) {
        throw new InsufficientStockError('batch-1', requested.toNumber(), this.remainingKg.toNumber());
      }
      this.remainingKg = subtract(this.remainingKg, requested);
      return { success: true, operationId, remaining: this.remainingKg.toFixed(3) };
    } finally {
      this.releaseLock();
    }
  }
}

describe('Concurrent stock consumption', () => {
  it('Scenario 1 — two concurrent 80 KG requests on 100 KG batch', async () => {
    const store = new MockBatchStore('100.000');

    const [result1, result2] = await Promise.allSettled([
      store.consume('80.000', 'op-device-a'),
      store.consume('80.000', 'op-device-b'),
    ]);

    // One must succeed
    const succeeded = [result1, result2].filter((r) => r.status === 'fulfilled');
    // One must fail
    const failed    = [result1, result2].filter((r) => r.status === 'rejected');

    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    expect(failed[0].reason).toBeInstanceOf(InsufficientStockError);

    // Remaining must be non-negative
    expect(parseFloat(store.remainingKg.toFixed(3))).toBeGreaterThanOrEqual(0);
  });

  it('total consumed across concurrent requests never exceeds original', async () => {
    const original = '1000.000';
    const store    = new MockBatchStore(original);

    // 20 concurrent requests of 60 KG each (total desired: 1200, only 1000 available)
    const requests = Array.from({ length: 20 }, (_, i) =>
      store.consume('60.000', `op-${i}`),
    );

    const results = await Promise.allSettled(requests);
    const succeeded = results.filter((r) => r.status === 'fulfilled');

    // Max 16 can succeed (16 * 60 = 960, 17th needs 60 but only 40 left)
    expect(succeeded.length).toBeLessThanOrEqual(16);

    // Remaining must be non-negative
    expect(parseFloat(store.remainingKg.toFixed(3))).toBeGreaterThanOrEqual(0);

    // Total consumed + remaining = original
    const consumed = new Decimal(original).minus(store.remainingKg);
    expect(parseFloat(consumed.toFixed(3))).toBeLessThanOrEqual(parseFloat(original));
  });

  it('exact last KG consumption — only one device gets the final batch', async () => {
    const store = new MockBatchStore('100.000');

    // First sell 99.999 KG
    await store.consume('99.999', 'op-first');
    expect(store.remainingKg.toFixed(3)).toBe('0.001');

    // Two devices race for the final 0.001 KG
    const [r1, r2] = await Promise.allSettled([
      store.consume('0.001', 'op-a'),
      store.consume('0.001', 'op-b'),
    ]);

    const succeeded = [r1, r2].filter((r) => r.status === 'fulfilled');
    const failed    = [r1, r2].filter((r) => r.status === 'rejected');

    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    expect(store.remainingKg.toFixed(3)).toBe('0.000');
  });
});

describe('Concurrent payment guard', () => {
  class MockPaymentStore {
    constructor(totalAmount, alreadyPaid) {
      this.totalAmount = new Decimal(totalAmount.toString());
      this.paid        = new Decimal(alreadyPaid.toString());
      this.lock        = false;
      this.queue       = [];
      this.payments    = [];
    }

    async acquireLock() {
      return new Promise((resolve) => {
        if (!this.lock) { this.lock = true; resolve(); }
        else this.queue.push(resolve);
      });
    }

    releaseLock() {
      if (this.queue.length > 0) this.queue.shift()();
      else this.lock = false;
    }

    get remaining() {
      return this.totalAmount.minus(this.paid);
    }

    async pay(amount, operationId) {
      await this.acquireLock();
      try {
        const pmtAmt = new Decimal(amount.toString());
        if (isGreaterThan(pmtAmt, this.remaining)) {
          throw new Error(`Overpayment: ${pmtAmt} > ${this.remaining}`);
        }
        this.paid = this.paid.plus(pmtAmt);
        this.payments.push({ operationId, amount });
        return { success: true };
      } finally {
        this.releaseLock();
      }
    }
  }

  it('concurrent payments cannot overpay', async () => {
    const store = new MockPaymentStore('1000.00', '0.00');

    // Two concurrent payments of 600 each — only 1000 total
    const [r1, r2] = await Promise.allSettled([
      store.pay('600.00', 'pay-op-1'),
      store.pay('600.00', 'pay-op-2'),
    ]);

    const succeeded = [r1, r2].filter((r) => r.status === 'fulfilled');
    const failed    = [r1, r2].filter((r) => r.status === 'rejected');

    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);

    // Total paid must not exceed total amount
    expect(parseFloat(store.paid.toFixed(2))).toBeLessThanOrEqual(1000);
  });
});
