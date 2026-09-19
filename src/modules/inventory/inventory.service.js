'use strict';

const prisma = require('../../database/prismaClient');
const { v4: uuidv4 } = require('uuid');
const engine = require('./inventory.engine');
const { nextCode } = require('../../common/utils/codeGenerator');
const { NotFoundError, BusinessRuleError, IdempotencyConflictError } = require('../../common/errors/AppError');
const { paginate, paginatedResponse } = require('../../common/utils/pagination');
const { subtract } = require('../../common/utils/decimal');

// ─── Batches ──────────────────────────────────────────────────────────────────

async function listBatches(query) {
  const { page, limit } = query;
  const where = {};
  if (query.locationId)  where.locationId  = query.locationId;
  if (query.coffeeTypeId) where.coffeeTypeId = query.coffeeTypeId;
  if (query.status)      where.status      = query.status;
  if (query.purchaseId)  where.purchaseId  = query.purchaseId;

  const [batches, total] = await prisma.$transaction([
    prisma.batch.findMany({
      where,
      ...paginate(page, limit),
      orderBy: { createdAt: 'desc' },
      include: {
        coffeeType: true,
        location: true,
        purchase: { select: { purchaseNumber: true, purchaseDate: true } },
      },
    }),
    prisma.batch.count({ where }),
  ]);
  return paginatedResponse(batches, total, page, limit);
}

async function getBatchById(id) {
  const batch = await prisma.batch.findUnique({
    where: { id },
    include: {
      coffeeType: true,
      location: true,
      purchase: true,
      purchaseItem: true,
      processingRun: true,
      ledgerEntries: { orderBy: { postedAt: 'desc' }, take: 50 },
      batchLineageAsInput: { include: { outputBatch: { include: { coffeeType: true } } } },
      batchLineageAsOutput: { include: { inputBatch: { include: { coffeeType: true } } } },
    },
  });
  if (!batch) throw new NotFoundError('Batch', id);
  return batch;
}

// ─── Stock Ledger ─────────────────────────────────────────────────────────────

async function listLedger(query) {
  const { page, limit } = query;
  const where = {};
  if (query.batchId)    where.batchId    = query.batchId;
  if (query.locationId) where.locationId = query.locationId;
  if (query.movementType) where.movementType = query.movementType;
  if (query.startDate || query.endDate) {
    where.postedAt = {};
    if (query.startDate) where.postedAt.gte = new Date(query.startDate);
    if (query.endDate)   where.postedAt.lte = new Date(query.endDate);
  }

  const [entries, total] = await prisma.$transaction([
    prisma.stockLedger.findMany({
      where,
      ...paginate(page, limit),
      orderBy: { postedAt: 'desc' },
      include: {
        batch: { select: { batchCode: true, coffeeTypeId: true } },
        location: { select: { name: true } },
        performedBy: { select: { fullName: true } },
      },
    }),
    prisma.stockLedger.count({ where }),
  ]);
  return paginatedResponse(entries, total, page, limit);
}

// ─── Transfers ────────────────────────────────────────────────────────────────

async function createTransfer(data, userId) {
  // Idempotency check
  const existing = await prisma.inventoryTransfer.findUnique({
    where: { operationId: data.operationId },
  });
  if (existing) {
    return { alreadyApplied: true, transfer: existing };
  }

  return prisma.$transaction(
    async (tx) => {
      const transferNumber = await nextCode(prisma, 'transfer', 'TRF');

      const transfer = await tx.inventoryTransfer.create({
        data: {
          id:             uuidv4(),
          transferNumber,
          fromLocationId: data.fromLocationId,
          toLocationId:   data.toLocationId,
          transferDate:   data.transferDate,
          notes:          data.notes,
          operationId:    data.operationId,
          createdById:    userId,
          deviceId:       data.deviceId,
        },
      });

      for (const line of data.lines) {
        // Lock source batch and consume
        const sourceBatch = await tx.batch.findUnique({ where: { id: line.fromBatchId } });
        if (!sourceBatch) throw new NotFoundError('Batch', line.fromBatchId);

        await engine.consumeFromBatch(tx, {
          batchId:       line.fromBatchId,
          quantityKg:    line.quantityKg,
          movementType:  'TRANSFER_OUT',
          sourceRef:     { transferId: transfer.id },
          performedById: userId,
          operationId:   `${data.operationId}:out:${line.fromBatchId}`,
          deviceId:      data.deviceId,
          notes:         `Transfer to ${data.toLocationId}`,
        });

        // Create a new batch at the destination location
        const newBatchCode = await nextCode(prisma, 'batch', 'BAT');
        const newBatch = await tx.batch.create({
          data: {
            id:           uuidv4(),
            batchCode:    newBatchCode,
            purchaseId:   sourceBatch.purchaseId,
            purchaseItemId: sourceBatch.purchaseItemId,
            coffeeTypeId: sourceBatch.coffeeTypeId,
            locationId:   data.toLocationId,
            originalKg:   line.quantityKg,
            remainingKg:  line.quantityKg,
            costPerKg:    sourceBatch.costPerKg,
            totalCost:    sourceBatch.costPerKg.times(line.quantityKg).toFixed(2),
            processingRunId: sourceBatch.processingRunId,
            status:       'ACTIVE',
            createdById:  userId,
            deviceId:     data.deviceId,
          },
        });

        // Inbound ledger entry at destination
        await engine.createLedgerEntry(tx, {
          batchId:       newBatch.id,
          locationId:    data.toLocationId,
          quantityKg:    line.quantityKg,
          movementType:  'TRANSFER_IN',
          transferId:    transfer.id,
          performedById: userId,
          operationId:   `${data.operationId}:in:${line.fromBatchId}`,
          deviceId:      data.deviceId,
          notes:         `Transfer from ${data.fromLocationId}`,
        });

        // Create transfer line record
        await tx.transferLine.create({
          data: {
            id:         uuidv4(),
            transferId: transfer.id,
            fromBatchId: line.fromBatchId,
            toBatchId:   newBatch.id,
            quantityKg:  line.quantityKg,
          },
        });
      }

      return transfer;
    },
    { isolationLevel: 'Serializable', timeout: 30_000 },
  );
}

// ─── Stock Adjustments ────────────────────────────────────────────────────────

async function createAdjustment(data, userId) {
  // Idempotency check
  const existing = await prisma.stockAdjustment.findUnique({
    where: { operationId: data.operationId },
  });
  if (existing) return { alreadyApplied: true, adjustment: existing };

  return prisma.$transaction(
    async (tx) => engine.createStockAdjustment(tx, { ...data, userId }),
    { isolationLevel: 'Serializable', timeout: 15_000 },
  );
}

// ─── Inventory overview ───────────────────────────────────────────────────────

async function getInventoryOverview(locationId) {
  const where = { status: { in: ['ACTIVE', 'PARTIALLY_CONSUMED'] } };
  if (locationId) where.locationId = locationId;

  const batches = await prisma.batch.findMany({
    where,
    include: {
      coffeeType: true,
      location: true,
    },
  });

  // Group by location + coffeeType
  const summary = {};
  for (const b of batches) {
    const key = `${b.locationId}:${b.coffeeTypeId}`;
    if (!summary[key]) {
      summary[key] = {
        locationId:    b.locationId,
        locationName:  b.location.name,
        coffeeTypeId:  b.coffeeTypeId,
        coffeeTypeName: b.coffeeType.name,
        totalKg:       0,
        totalCost:     0,
        batchCount:    0,
      };
    }
    summary[key].totalKg    += parseFloat(b.remainingKg);
    summary[key].totalCost  += parseFloat(b.totalCost);
    summary[key].batchCount += 1;
  }

  return Object.values(summary);
}

module.exports = {
  listBatches,
  getBatchById,
  listLedger,
  createTransfer,
  createAdjustment,
  getInventoryOverview,
};
