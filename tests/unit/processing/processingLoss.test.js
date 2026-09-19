'use strict';

const { calcLossPercentage, allocateCostProportionally, isGreaterThan, Decimal } = require('../../../src/common/utils/decimal');
const { ProcessingOutputExceedsInputError } = require('../../../src/common/errors/AppError');

// ─── Simulates processing validation logic ────────────────────────────────────

function validateProcessingOutput(totalInputKg, totalOutputKg) {
  const input  = new Decimal(totalInputKg.toString());
  const output = new Decimal(totalOutputKg.toString());
  if (isGreaterThan(output, input)) {
    throw new ProcessingOutputExceedsInputError(output.toNumber(), input.toNumber());
  }
  return {
    lossKg:  input.minus(output).toFixed(3),
    lossPct: calcLossPercentage(input, output).toFixed(4),
  };
}

describe('Processing loss calculation', () => {
  it('calculates loss correctly for wet → dry conversion', () => {
    const result = validateProcessingOutput(800, 600);
    expect(result.lossKg).toBe('200.000');
    expect(result.lossPct).toBe('25.0000');
  });

  it('zero loss when output equals input', () => {
    const result = validateProcessingOutput(500, 500);
    expect(result.lossKg).toBe('0.000');
    expect(result.lossPct).toBe('0.0000');
  });

  it('handles fractional KG precisely', () => {
    const result = validateProcessingOutput('700.500', '630.450');
    expect(result.lossKg).toBe('70.050');
    expect(parseFloat(result.lossPct)).toBeCloseTo(9.9999, 2);
  });

  it('Scenario 7 — output exceeds input throws', () => {
    expect(() => validateProcessingOutput(500, 500.001))
      .toThrow(ProcessingOutputExceedsInputError);
  });

  it('Scenario 7 — exact violation error carries correct values', () => {
    try {
      validateProcessingOutput(500, 501);
    } catch (err) {
      expect(err.code).toBe('PROCESSING_OUTPUT_EXCEEDS_INPUT');
      expect(err.details.outputKg).toBe(501);
      expect(err.details.inputKg).toBe(500);
    }
  });

  describe('out-of-range detection', () => {
    const MIN_PCT = 0;
    const MAX_PCT = 30;

    function isOutOfRange(lossPct) {
      return parseFloat(lossPct) < MIN_PCT || parseFloat(lossPct) > MAX_PCT;
    }

    it('10% loss is within range', () => {
      const { lossPct } = validateProcessingOutput(100, 90);
      expect(isOutOfRange(lossPct)).toBe(false);
    });

    it('35% loss is out of range', () => {
      const { lossPct } = validateProcessingOutput(100, 65);
      expect(isOutOfRange(lossPct)).toBe(true);
    });

    it('exactly 30% loss is NOT out of range (boundary)', () => {
      const { lossPct } = validateProcessingOutput(100, 70);
      expect(isOutOfRange(lossPct)).toBe(false);
    });

    it('30.001% loss IS out of range', () => {
      const { lossPct } = validateProcessingOutput('1000.000', '699.999');
      expect(isOutOfRange(lossPct)).toBe(true);
    });
  });
});

describe('Processing cost allocation', () => {
  it('allocates proportionally to output quantities', () => {
    // 2 outputs: 400 KG and 600 KG, total cost 1000
    const costs = allocateCostProportionally('1000', ['400', '600']);
    expect(costs[0].toFixed(2)).toBe('400.00');
    expect(costs[1].toFixed(2)).toBe('600.00');
    // Total must equal input exactly
    expect(costs[0].plus(costs[1]).toFixed(2)).toBe('1000.00');
  });

  it('handles unequal split and rounding correctly — no money lost', () => {
    // 3 outputs, cost splits unevenly
    const costs = allocateCostProportionally('1000', ['333', '333', '334']);
    const total  = costs.reduce((a, c) => a.plus(c), new Decimal(0));
    expect(total.toFixed(2)).toBe('1000.00');
  });

  it('includes processing overhead in cost allocation', () => {
    // Input cost = 800, overhead = 200, total to allocate = 1000
    const inputCost   = new Decimal('800');
    const overhead    = new Decimal('200');
    const totalCost   = inputCost.plus(overhead);
    const costs       = allocateCostProportionally(totalCost, ['500', '500']);
    expect(costs[0].toFixed(2)).toBe('500.00');
    expect(costs[1].toFixed(2)).toBe('500.00');
  });

  it('throws when total quantity is zero', () => {
    expect(() => allocateCostProportionally('1000', ['0', '0']))
      .toThrow('Cannot allocate cost: total quantity is zero');
  });
});
