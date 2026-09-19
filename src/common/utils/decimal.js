'use strict';

/**
 * Decimal utilities.
 * We use JS number only for display/comparison.
 * All DB values are Prisma Decimal objects — these helpers work with them.
 *
 * NEVER use floating-point arithmetic for business calculations.
 * These helpers use string-based arithmetic via Decimal.js (bundled with Prisma).
 */

const { Decimal } = require('@prisma/client/runtime/library');

/**
 * Converts any Prisma Decimal, string, or number to a plain JS number.
 * Use ONLY for display/serialisation — not for calculations.
 */
function toNumber(value) {
  if (value === null || value === undefined) return null;
  return new Decimal(value.toString()).toNumber();
}

/**
 * Adds two Decimal-compatible values with full precision.
 * Returns a Decimal.
 */
function add(a, b) {
  return new Decimal(a.toString()).plus(new Decimal(b.toString()));
}

/**
 * Subtracts b from a. Returns a Decimal.
 */
function subtract(a, b) {
  return new Decimal(a.toString()).minus(new Decimal(b.toString()));
}

/**
 * Multiplies a by b. Returns a Decimal.
 */
function multiply(a, b) {
  return new Decimal(a.toString()).times(new Decimal(b.toString()));
}

/**
 * Divides a by b. Returns a Decimal.
 * Throws if b is zero.
 */
function divide(a, b) {
  const divisor = new Decimal(b.toString());
  if (divisor.isZero()) throw new Error('Division by zero');
  return new Decimal(a.toString()).dividedBy(divisor);
}

/**
 * Compares two Decimal-compatible values.
 * Returns -1, 0, or 1.
 */
function compare(a, b) {
  return new Decimal(a.toString()).comparedTo(new Decimal(b.toString()));
}

function isGreaterThan(a, b) { return compare(a, b) > 0; }
function isLessThan(a, b)    { return compare(a, b) < 0; }
function isEqual(a, b)       { return compare(a, b) === 0; }
function isNonNegative(a)    { return compare(a, 0) >= 0; }
function isPositive(a)       { return compare(a, 0) > 0; }
function isZero(a)           { return compare(a, 0) === 0; }

/**
 * Rounds to n decimal places using ROUND_HALF_UP.
 * Returns a Decimal.
 */
function round(value, decimals = 2) {
  return new Decimal(value.toString()).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
}

/**
 * Calculates loss percentage.
 * loss_pct = (loss_kg / input_kg) * 100
 * Returns a Decimal rounded to 4 decimal places.
 */
function calcLossPercentage(inputKg, outputKg) {
  const input  = new Decimal(inputKg.toString());
  const output = new Decimal(outputKg.toString());
  if (input.isZero()) return new Decimal(0);
  const lossKg = input.minus(output);
  return lossKg.dividedBy(input).times(100).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/**
 * Allocates a total cost across multiple quantities proportionally.
 * Returns an array of Decimal values (same length as quantities array).
 * The last element absorbs any rounding remainder.
 */
function allocateCostProportionally(totalCost, quantities) {
  const totalQty = quantities.reduce(
    (acc, q) => acc.plus(new Decimal(q.toString())),
    new Decimal(0),
  );
  if (totalQty.isZero()) throw new Error('Cannot allocate cost: total quantity is zero');

  const total = new Decimal(totalCost.toString());
  const allocated = [];
  let allocated_sum = new Decimal(0);

  for (let i = 0; i < quantities.length - 1; i++) {
    const qty   = new Decimal(quantities[i].toString());
    const share = total.times(qty).dividedBy(totalQty).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    allocated.push(share);
    allocated_sum = allocated_sum.plus(share);
  }

  // Last element absorbs rounding difference
  allocated.push(total.minus(allocated_sum));
  return allocated;
}

module.exports = {
  Decimal,
  toNumber,
  add,
  subtract,
  multiply,
  divide,
  compare,
  isGreaterThan,
  isLessThan,
  isEqual,
  isNonNegative,
  isPositive,
  isZero,
  round,
  calcLossPercentage,
  allocateCostProportionally,
};
