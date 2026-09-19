'use strict';

const { v4: uuidv4 } = require('uuid');
const prisma = require('../../database/prismaClient');
const logger = require('../../common/logger');
const {
  SyncConflictDetectedError,
  BusinessRuleError,
} = require('../../common/errors/AppError');

// ─── Entity version map ───────────────────────────────────────────────────────
// Maps entity types to their Prisma model names for version checking

const ENTITY_MAP = {
  purchase:    'purchase',
  sale:        'sale',
  batch:       'batch',
  processingRun: 'processingRun',
  payment:     'payment',
  stockAdjustment: 'stockAdjustment',
  inventoryTransfer: 'inventoryTransfer',
  agent:       'agent',
};

// ─── Push ─────────────────────────────────────────────────────────────────────

/**
 * Process a batch of sync operations from an offline device.
 * Each operation is processed independently with full idempotency.
 *
 * Rules:
 *  1. If operation has already been applied → return success (idempotent)
 *  2. If entity version on server != baseVersion → CONFLICT
 *  3. Apply the operation
 *  4. Record sync operation as SYNCED
 */
async function processPush(operations, deviceId) {
  const results = [];

  for (const op of operations) {
    const result = await processSingleOperation(op, deviceId);
    results.push(result);
  }

  return results;
}

async function processSingleOperation(op, deviceId) {
  // Idempotency: operation already processed
  const existing = await prisma.syncOperation.findUnique({
    where: { operationId: op.operationId },
  });

  if (existing && existing.status === 'SYNCED') {
    return { operationId: op.operationId, status: 'ALREADY_APPLIED', conflict: false };
  }

  // Record the operation (upsert so we can update status on retry)
  await prisma.syncOperation.upsert({
    where:  { operationId: op.operationId },
    update: { status: 'PENDING', errorMessage: null },
    create: {
      id:            uuidv4(),
      operationId:   op.operationId,
      entityType:    op.entityType,
      entityId:      op.entityId,
      operationType: op.operationType,
      baseVersion:   op.baseVersion,
      payload:       op.payload,
      deviceId:      op.deviceId || deviceId,
      status:        'PENDING',
    },
  });

  try {
    // Check server version for conflict detection
    const modelName = ENTITY_MAP[op.entityType];
    if (modelName && op.operationType === 'UPDATE') {
      const serverRecord = await prisma[modelName].findUnique({
        where: { id: op.entityId },
        select: { version: true },
      });

      if (serverRecord && serverRecord.version !== op.baseVersion) {
        // CONFLICT: server version diverged from base version
        await createConflict({
          entityType:    op.entityType,
          entityId:      op.entityId,
          localVersion:  op.baseVersion,
          serverVersion: serverRecord.version,
          localPayload:  op.payload,
          serverPayload: serverRecord,
          deviceId:      op.deviceId || deviceId,
          operationId:   op.operationId,
        });

        await prisma.syncOperation.update({
          where: { operationId: op.operationId },
          data:  { status: 'CONFLICT' },
        });

        return {
          operationId: op.operationId,
          status:      'CONFLICT',
          conflict:    true,
          message:     `Version conflict on ${op.entityType} ${op.entityId}`,
        };
      }
    }

    // Dispatch operation to appropriate handler
    await dispatchOperation(op);

    await prisma.syncOperation.update({
      where: { operationId: op.operationId },
      data:  { status: 'SYNCED', appliedAt: new Date() },
    });

    logger.info(
      { operationId: op.operationId, entityType: op.entityType, operationType: op.operationType },
      'Sync operation applied',
    );

    return { operationId: op.operationId, status: 'SYNCED', conflict: false };
  } catch (err) {
    await prisma.syncOperation.update({
      where: { operationId: op.operationId },
      data:  { status: 'FAILED', errorMessage: err.message },
    });

    logger.error(
      { operationId: op.operationId, err },
      'Sync operation failed',
    );

    return {
      operationId: op.operationId,
      status:      'FAILED',
      conflict:    false,
      error:       err.message,
    };
  }
}

async function dispatchOperation(op) {
  // Route to the appropriate service based on entity type and operation type
  const { entityType, operationType, entityId, payload } = op;

  switch (entityType) {
    case 'purchase': {
      if (operationType === 'CREATE') {
        const svc = require('../purchases/purchases.service');
        await svc.createPurchase(payload, payload.createdById);
      } else if (operationType === 'APPROVE') {
        const svc = require('../purchases/purchases.service');
        await svc.approvePurchase(entityId, op.operationId, payload.userId);
      }
      break;
    }
    case 'sale': {
      if (operationType === 'CREATE') {
        const svc = require('../sales/sales.service');
        await svc.createSale(payload, payload.createdById);
      } else if (operationType === 'CONFIRM') {
        const svc = require('../sales/sales.service');
        await svc.confirmSale(entityId, op.operationId, payload.userId);
      }
      break;
    }
    case 'payment': {
      if (operationType === 'CREATE') {
        const svc = require('../payments/payments.service');
        if (payload.purchaseId) {
          await svc.createPurchasePayment(payload.purchaseId, payload, payload.createdById);
        } else {
          await svc.createSalePayment(payload.saleId, payload, payload.createdById);
        }
      }
      break;
    }
    case 'stockAdjustment': {
      if (operationType === 'CREATE') {
        const svc = require('../inventory/inventory.service');
        await svc.createAdjustment(payload, payload.userId);
      }
      break;
    }
    case 'processingRun': {
      if (operationType === 'COMPLETE') {
        const svc = require('../processing/processing.service');
        await svc.completeProcessing(entityId, payload, op.operationId, payload.userId);
      }
      break;
    }
    default:
      logger.warn({ entityType, operationType }, 'Unknown sync operation entity type');
  }
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

/**
 * Returns all records changed since lastSyncAt for the requesting device.
 */
async function processPull({ deviceId, lastSyncAt, entityTypes }) {
  const since = lastSyncAt ? new Date(lastSyncAt) : new Date(0);
  const types = entityTypes || Object.keys(ENTITY_MAP);
  const payload = {};

  if (types.includes('purchase')) {
    payload.purchases = await prisma.purchase.findMany({
      where:   { updatedAt: { gt: since } },
      include: { items: true },
      orderBy: { updatedAt: 'asc' },
      take:    500,
    });
  }
  if (types.includes('sale')) {
    payload.sales = await prisma.sale.findMany({
      where:   { updatedAt: { gt: since } },
      include: { items: true },
      orderBy: { updatedAt: 'asc' },
      take:    500,
    });
  }
  if (types.includes('batch')) {
    payload.batches = await prisma.batch.findMany({
      where:   { updatedAt: { gt: since } },
      orderBy: { updatedAt: 'asc' },
      take:    1000,
    });
  }
  if (types.includes('agent')) {
    payload.agents = await prisma.agent.findMany({
      where:   { updatedAt: { gt: since } },
      orderBy: { updatedAt: 'asc' },
    });
  }
  if (types.includes('payment')) {
    payload.payments = await prisma.payment.findMany({
      where:   { updatedAt: { gt: since } },
      orderBy: { updatedAt: 'asc' },
      take:    500,
    });
  }

  // Reference data (locations, coffeeTypes, users — always send if changed)
  payload.locations   = await prisma.location.findMany({ where: { updatedAt: { gt: since } } });
  payload.coffeeTypes = await prisma.coffeeType.findMany({ where: { updatedAt: { gt: since } } });

  payload.syncedAt = new Date().toISOString();
  return payload;
}

// ─── Conflicts ────────────────────────────────────────────────────────────────

async function createConflict(data) {
  return prisma.syncConflict.create({
    data: {
      id:            uuidv4(),
      entityType:    data.entityType,
      entityId:      data.entityId,
      localVersion:  data.localVersion,
      serverVersion: data.serverVersion,
      localPayload:  data.localPayload,
      serverPayload: data.serverPayload,
      deviceId:      data.deviceId,
      status:        'OPEN',
      operationId:   data.operationId,
    },
  });
}

async function listConflicts(query) {
  const where = { status: query.status || 'OPEN' };
  if (query.deviceId) where.deviceId = query.deviceId;
  return prisma.syncConflict.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { resolvedBy: { select: { fullName: true } } },
  });
}

async function getConflict(id) {
  const c = await prisma.syncConflict.findUnique({
    where: { id },
    include: { resolvedBy: { select: { fullName: true } } },
  });
  if (!c) throw new BusinessRuleError('NOT_FOUND', `Conflict ${id} not found`);
  return c;
}

/**
 * Human resolution of a sync conflict.
 * Boss/Admin explicitly chooses the correct version.
 * For financial/stock records we prefer creating a compensating entry
 * rather than rewriting history.
 */
async function resolveConflict(id, { resolution, mergedPayload, notes }, userId) {
  const conflict = await getConflict(id);

  if (conflict.status !== 'OPEN') {
    throw new BusinessRuleError(
      'CONFLICT_ALREADY_RESOLVED',
      `Conflict ${id} has already been resolved`,
    );
  }

  // For USE_LOCAL: apply the local payload as a new operation
  if (resolution === 'USE_LOCAL') {
    await dispatchOperation({
      operationId:   `${conflict.operationId}:resolution`,
      entityType:    conflict.entityType,
      entityId:      conflict.entityId,
      operationType: 'UPDATE',
      baseVersion:   conflict.serverVersion, // use server version as base now
      payload:       conflict.localPayload,
    });
  }
  // USE_SERVER: discard local changes — no action needed
  // MANUAL: apply merged payload
  else if (resolution === 'MANUAL' && mergedPayload) {
    await dispatchOperation({
      operationId:   `${conflict.operationId}:manual`,
      entityType:    conflict.entityType,
      entityId:      conflict.entityId,
      operationType: 'UPDATE',
      baseVersion:   conflict.serverVersion,
      payload:       mergedPayload,
    });
  }

  return prisma.syncConflict.update({
    where: { id },
    data: {
      status:      'RESOLVED',
      resolvedById: userId,
      resolvedAt:  new Date(),
      resolution:  `${resolution}: ${notes || ''}`,
      updatedAt:   new Date(),
    },
  });
}

module.exports = {
  processPush,
  processPull,
  listConflicts,
  getConflict,
  resolveConflict,
};
