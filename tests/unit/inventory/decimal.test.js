'use strict';

const {
  add, subtract, multiply, divide,
  isGreaterThan, isLessThan, isEqual, isZero,
  round, calcLossPercentage, allocateCostProportionally, Decimal,
} = require('../../../src/common/utils/decimal');

describe('Decimal utilities', () => {
  describe('basic arithmetic', () => {
    it('adds correctly', () => {
      expect(add('100.123', '200.456').toFixed(3)).toBe('300.579');
    });
    it('subtracts correctly', () => {
      expect(subtract('300.579', '200.456').toFixed(3)).toBe('100.123');
    });
    it('multiplies correctly without floating-point error', () => {
      // Classic float hazard: 0.1 * 0.2 = 0.020000000000000004
      expect(multiply('0.1', '0.2').toFixed(2)).toBe('0.02');
    });
    it('divides correctly', () => {
      expect(divide('10', '3').toFixed(4)).toBe('3.3333');
    });
    it('throws on division by zero', () => {
      expect(() => divide(10, 0)).toThrow('Division by zero');
    });
  });

  describe('comparisons', () => {
    it('detects greater than', () => {
      expect(isGreaterThan('100.001', '100.000')).toBe(true);
      expect(isGreaterThan('100.000', '100.001')).toBe(false);
    });
    it('detects equality', () => {
      expect(isEqual('123.456', '123.456')).toBe(true);
    });
    it('detects zero', () => {
      expect(isZero('0.000')).toBe(true);
      expect(isZero('0.001')).toBe(false);
    });
  });

  describe('loss percentage', () => {
    it('calculates loss correctly', () => {
      const result = calcLossPercentage('800', '600');
      expect(result.toNumber()).toBeCloseTo(25.0, 4);
    });
    it('returns 0 for zero input', () => {
      expect(calcLossPercentage('0', '0').toNumber()).toBe(0);
    });
  });

  describe('cost allocation', () => {
    it('allocates proportionally', () => {
      const costs = allocateCostProportionally('1000', ['400', '600']);
      expect(costs[0].toFixed(2)).toBe('400.00');
      expect(costs[1].toFixed(2)).toBe('600.00');
    });
    it('handles rounding remainder in last element', () => {
      // 100 / 3 = 33.333... — last element gets remainder
      const costs = allocateCostProportionally('100', ['1', '1', '1']);
      const total = costs.reduce((a, c) => a.plus(c), new Decimal(0));
      expect(total.toFixed(2)).toBe('100.00');
    });
    it('throws on zero total quantity', () => {
      expect(() => allocateCostProportionally('1000', ['0', '0'])).toThrow();
    });
  });
});
