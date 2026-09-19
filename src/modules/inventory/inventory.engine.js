'use strict';

/**
 * INVENTORY ENGINE
 * ================
 * The single authoritative source for all stock movements.
 * 
 * Rules:
 *  1. Every KG movement goes through this engine — no direct batch updates.
 *  2. All critical operations use SELECT FOR UPDATE to prevent race conditions.
 *  3. Remaining KG is kept denormalised on the batch for fast reads, but the
 *     stock_ledger is always the authoritative truth.
 *  4. The DB CHECK constraint prevents remaining_kg < 0 as a final safety net.
 */

const { v4: uuidv4 } = require('uuid');
const { subtract, add, isGreaterThan, Decimal } = require('../../common/utils/decimal');
const {
  InsufficientStockError,
  NotFoundError,
  BusinessRuleError,
} = require('../../common/errors/AppError');

/**
 * Creates an immutable stock ledger entry.
 * Called inside a transaction (tx = Prisma transaction client).
 * 
 * @param {object} tx    - Prisma transaction client
 * @param {object} entry - Ledger entry data
 */
async function createLedgerEntry(tx, entry) {
  // Validate exactly one source reference
  const sources = [
    entry.purchaseId,
    entry.processingRunId,
    entry.saleId,
    entry.transferId,
    entry.adjustmentId,
    entry.reversalOfId,
  ];
  const nonNullSources = sources.filter(Boolean);
  if (nonNullSources.length !== 1) {
    throw new BusinessRuleError(
      'LEDGER_SOURCE_INTEGRITY',
      `Stock ledger entry must have exactly 1 source reference, got ${nonNullSources.length}`,
    );
  }

  return tx.stockLedger.create({
    data: {
      id:             uuidv4(),
      batchId:        entry.batchId,
      locationId:     entry.locationId,
      quantityKg:     entry.quantityKg,
      movementType:   entry.movementType,
      purchaseId:     entry.purchaseId     || null,
      processingRunId: entry.processingRunId || null,
      saleId:         entry.saleId          || null,
      transferId:     entry.transferId      || null,
      adjustmentId:   entry.adjustmentId    || null,
      reversalOfId:   entry.reversalOfId    || null,
      performedById:  entry.performedById,
      deviceId:       entry.deviceId        || null,
      operationId:    entry.operationId,
      notes:          entry.notes           || null,
    },
  });
}

/**
 * Consumes KG from a batch using SELECT FOR UPDATE.
 * Prevents two concurrent transactions from over-consuming the same batch.
 *
 * @param {object}  tx          - Prisma transaction client
 * @param {string}  batchId
 * @param {Decimal|number} quantityKg  - KG to consume (positive number)
 * @param {string}  movementType
 * @param {object}  sourceRef   - Exactly one of: { saleId, processingRunId, transferId, adjustmentId }
 * @param {string}  performedById
 * @param {string}  operationId
 * @param {string}  [deviceId]
 * @param {string}  [notes]
 * @returns {object} Updated batch
 */
async function consumeFromBatch(tx, {
  batchId,
  quantityKg,
  movementType,
  sourceRef,
  performedById,
  operationId,
  deviceId,
  notes,
}) {
  // Lock the batch row — prevents any other transaction from reading stale remainingKg
  const [lockedBatch] = await tx.$queryRaw`
    SELECT id, "remainingKg", "locationId", status
    FROM batches
    WHERE id = ${batchId}::uuid
    FOR UPDATE
  `;

  if (!lockedBatch) throw new NotFoundError('Batch', batchId);

  if (lockedBatch.status === 'CONSUMED') {
    throw new BusinessRuleError(
      'BATCH_FULLY_CONSUMED',
      `Batch ${batchId} has already been fully consumed`,
    );
  }

  const remaining = new Decimal(lockedBatch.remainingKg.toString());
  const requested = new Decimal(quantityKg.toString());

  if (isGreaterThan(requested, remaining)) {
    throw new InsufficientStockError(batchId, requested.toNumber(), remaining.toNumber());
  }

  const newRemaining = subtract(remaining, requested);
  const newStatus    = newRemaining.isZero() ? 'CONSUMED' : 'PARTIALLY_CONSUMED';

  // Update batch remaining KG
  const updatedBatch = await tx.batch.update({
    where: { id: batchId },
    data: {
      remainingKg: newRemaining.toFixed(3),
      status:      newStatus,
      version:     { increment: 1 },
    },
  });

  // Create outbound ledger entry (negative quantityKg)
  await createLedgerEntry(tx, {
    batchId,
    locationId:    lockedBatch.locationId,
    quantityKg:    `-${requested.toFixed(3)}`,
    movementType,
    ...sourceRef,
    performedById,
    operationId,
    deviceId,
    notes,
  });

  return updatedBatch;
}

/**
 * Adds KG to a batch (for adjustments that increase stock, or transfer receipts).
 */
async function addToBatch(tx, {
  batchId,
  quantityKg,
  movementType,
  sourceRef,
  performedById,
  operationId,
  deviceId,
  notes,
}) {
  const [lockedBatch] = await tx.$queryRaw`
    SELECT id, "remainingKg", "originalKg", "locationId"
    FROM batches
    WHERE id = ${batchId}::uuid
    FOR UPDATE
  `;

  if (!lockedBatch) throw new NotFoundError('Batch', batchId);

  const remaining    = new Decimal(lockedBatch.remainingKg.toString());
  const qty          = new Decimal(quantityKg.toString());
  const newRemaining = add(remaining, qty);

  const updatedBatch = await tx.batch.update({
    where: { id: batchId },
    data: {
      remainingKg: newRemaining.toFixed(3),
      status:      'ACTIVE',
      version:     { increment: 1 },
    },
  });

  await createLedgerEntry(tx, {
    batchId,
    locationId:   lockedBatch.locationId,
    quantityKg:   qty.toFixed(3),
    movementType,
    ...sourceRef,
    performedById,
    operationId,
    deviceId,
    notes,
  });

  return updatedBatch;
}

/**
 * Reconciles batch remaining_kg with the ledger.
 * Returns the computed ledger balance for a batch.
 * This is used in reconciliation verification.
 */
async function computeLedgerBalance(batchId) {
  const result = await require('../../database/prismaClient').stockLedger.aggregate({
    where: { batchId },
    _sum: { quantityKg: true },
  });
  return result._sum.quantityKg || new Decimal(0);
}

/**
 * Creates a stock adjustment (increase or decrease) and corresponding ledger entry.
 * Must be called inside a transaction or standalone.
 */
async function createStockAdjustment(tx, {
  batchId,
  direction,
  quantityKg,
  reason,
  reconciliationSessionId,
  operationId,
  userId,
  deviceId,
}) {
  const { nextCode } = require('../../common/utils/codeGenerator');
  const prismaClient = require('../../database/prismaClient');
  const adjustmentNumber = await nextCode(prismaClient, 'adjustment', 'ADJ');
  const { v4: uuid } = require('uuid');

  const adjustment = await tx.stockAdjustment.create({
    data: {
      id:                      uuid(),
      adjustmentNumber,
      batchId,
      direction,
      quantityKg,
      reason,
      reconciliationSessionId: reconciliationSessionId || null,
      operationId,
      createdById:             userId,
      deviceId:                deviceId || null,
    },
  });

  if (direction === 'INCREASE') {
    await addToBatch(tx, {
      batchId,
      quantityKg,
      movementType: 'STOCK_ADJUSTMENT_INCREASE',
      sourceRef:    { adjustmentId: adjustment.id },
      performedById: userId,
      operationId:  `${operationId}:ledger`,
      deviceId,
      notes:        reason,
    });
  } else {
    await consumeFromBatch(tx, {
      batchId,
      quantityKg,
      movementType: 'STOCK_ADJUSTMENT_DECREASE',
      sourceRef:    { adjustmentId: adjustment.id },
      performedById: userId,
      operationId:  `${operationId}:ledger`,
      deviceId,
      notes:        reason,
    });
  }

  return adjustment;
}

module.exports = { createLedgerEntry, consumeFromBatch, addToBatch, computeLedgerBalance, createStockAdjustment };
