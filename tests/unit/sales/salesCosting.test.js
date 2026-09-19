'use strict';

const { multiply, subtract, Decimal } = require('../../../src/common/utils/decimal');

/**
 * Unit tests for sale cost capture and gross margin calculation.
 * Uses specific batch costing strategy — cost is taken from the exact batch
 * being sold, not FIFO/LIFO/weighted average.
 */

function computeSaleItemFinancials(quantityKg, unitSalePrice, batchCostPerKg) {
  const qty      = new Decimal(quantityKg.toString());
  const saleAmt  = multiply(qty, unitSalePrice);
  const costAmt  = multiply(qty, batchCostPerKg);
  const margin   = subtract(saleAmt, costAmt);

  return {
    saleAmount:  saleAmt.toFixed(2),
    costAmount:  costAmt.toFixed(2),
    grossMargin: margin.toFixed(2),
  };
}

describe('Sale item cost assignment (specific batch costing)', () => {
  it('calculates gross margin correctly', () => {
    // Bought at 45/KG, sold at 120/KG, 100 KG
    const r = computeSaleItemFinancials('100.000', '120.00', '45.00');
    expect(r.saleAmount).toBe('12000.00');
    expect(r.costAmount).toBe('4500.00');
    expect(r.grossMargin).toBe('7500.00');
  });

  it('negative margin when sold below cost', () => {
    const r = computeSaleItemFinancials('100.000', '40.00', '45.00');
    expect(parseFloat(r.grossMargin)).toBeLessThan(0);
    expect(r.grossMargin).toBe('-500.00');
  });

  it('zero margin when sold at cost', () => {
    const r = computeSaleItemFinancials('50.000', '45.00', '45.00');
    expect(r.grossMargin).toBe('0.00');
  });

  it('uses exact batch cost — not an average', () => {
    // Two batches: Batch A cost 40/KG, Batch B cost 60/KG
    const itemA = computeSaleItemFinancials('100.000', '120.00', '40.00');
    const itemB = computeSaleItemFinancials('100.000', '120.00', '60.00');

    expect(itemA.costAmount).toBe('4000.00');
    expect(itemB.costAmount).toBe('6000.00');

    // Costs differ by batch — specific costing preserved
    expect(itemA.costAmount).not.toBe(itemB.costAmount);
  });

  it('fractional KG calculations have no floating-point error', () => {
    // Classic: 0.1 * 0.2 float hazard
    const r = computeSaleItemFinancials('0.100', '0.200', '0.050');
    expect(r.saleAmount).toBe('0.02');
    expect(r.costAmount).toBe('0.01');
  });

  it('total sale aggregates correctly across multiple items', () => {
    const items = [
      computeSaleItemFinancials('100.000', '120.00', '45.00'),
      computeSaleItemFinancials('200.000', '115.00', '43.00'),
      computeSaleItemFinancials('50.000',  '125.00', '47.50'),
    ];

    const totalSale   = items.reduce((a, i) => a.plus(new Decimal(i.saleAmount)),   new Decimal(0));
    const totalCost   = items.reduce((a, i) => a.plus(new Decimal(i.costAmount)),   new Decimal(0));
    const totalMargin = items.reduce((a, i) => a.plus(new Decimal(i.grossMargin)),  new Decimal(0));

    // totalSale - totalCost must equal totalMargin exactly
    expect(totalSale.minus(totalCost).toFixed(2)).toBe(totalMargin.toFixed(2));
  });
});
