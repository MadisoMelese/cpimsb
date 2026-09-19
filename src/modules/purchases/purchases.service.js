'use strict';

const { v4: uuidv4 } = require('uuid');
const prisma  = require('../../database/prismaClient');
const { nextCode }   = require('../../common/utils/codeGenerator');
const { isGreaterThan, multiply, add } = require('../../common/utils/decimal');
const {
  NotFoundError,
  BusinessRuleError,
  InvalidStatusTransitionError,
  IdempotencyConflictError,
} = require('../../common/errors/AppError');
const { paginate, paginatedResponse } = require('../../common/utils/pagination');
const inventoryEngine = require('../inventory/inventory.engine');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assertStatus(purchase, ...allowed) {
  if (!allowed.includes(purchase.status)) {
    throw new InvalidStatusTransitionError(
      'Purchase',
      purchase.status,
      allowed.join('/'),
    );
  }
}

// ─── Create ───────────────────────────────────────────────────────────────────

async function createPurchase(data, userId) {
  const purchaseNumber = await nextCode(prisma, 'purchase', 'PUR');

  const purchase = await prisma.purchase.create({
    data: {
      id:             uuidv4(),
      purchaseNumber,
      agentId:        data.agentId,
      locationId:     data.locationId,
      purchaseDate:   data.purchaseDate,
      creditTerms:    data.creditTerms || 'CASH',
      creditDueDays:  data.creditDueDays,
      currency:       data.currency || 'KES',
      notes:          data.notes,
      createdById:    userId,
      deviceId:       data.deviceId,
      status:         'DRAFT',
      items: {
        create: data.items.map((item) => ({
          id:             uuidv4(),
          coffeeTypeId:   item.coffeeTypeId,
          quantityKg:     item.quantityKg,
          unitPriceKg:    item.unitPriceKg,
          totalPrice:     multiply(item.quantityKg, item.unitPriceKg).toFixed(2),
          moistureContent: item.moistureContent,
          notes:          item.notes,
        })),
      },
    },
    include: { items: true, agent: true, location: true },
  });

  return purchase;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

async function listPurchases(query) {
  const { page, limit } = query;
  const where = {};
  if (query.status)   where.status   = query.status;
  if (query.agentId)  where.agentId  = query.agentId;
  if (query.locationId) where.locationId = query.locationId;
  if (query.startDate || query.endDate) {
    where.purchaseDate = {};
    if (query.startDate) where.purchaseDate.gte = new Date(query.startDate);
    if (query.endDate)   where.purchaseDate.lte = new Date(query.endDate);
  }

  const [purchases, total] = await prisma.$transaction([
    prisma.purchase.findMany({
      where,
      ...paginate(page, limit),
      orderBy: { purchaseDate: 'desc' },
      include: {
        agent: { select: { id: true, name: true, code: true } },
        location: { select: { id: true, name: true } },
        items: true,
        _count: { select: { payments: true } },
      },
    }),
    prisma.purchase.count({ where }),
  ]);

  return paginatedResponse(purchases, total, page, limit);
}

async function getPurchaseById(id) {
  const purchase = await prisma.purchase.findUnique({
    where: { id },
    include: {
      agent: true,
      location: true,
      items: { include: { coffeeType: true } },
      batches: true,
      payments: true,
      createdBy:   { select: { id: true, fullName: true } },
      verifiedBy:  { select: { id: true, fullName: true } },
      approvedBy:  { select: { id: true, fullName: true } },
    },
  });
  if (!purchase) throw new NotFoundError('Purchase', id);
  return purchase;
}

// ─── Status workflow ──────────────────────────────────────────────────────────

async function updatePurchase(id, data, _userId) {
  const purchase = await getPurchaseById(id);
  assertStatus(purchase, 'DRAFT', 'REJECTED');

  return prisma.purchase.update({
    where: { id },
    data: {
      ...data,
      version: { increment: 1 },
    },
    include: { items: true },
  });
}

async function submitPurchase(id, userId) {
  const purchase = await getPurchaseById(id);
  assertStatus(purchase, 'DRAFT');

  if (purchase.items.length === 0) {
    throw new BusinessRuleError('PURCHASE_NO_ITEMS', 'Cannot submit a purchase with no items');
  }

  return prisma.purchase.update({
    where: { id },
    data: { status: 'SUBMITTED', submittedAt: new Date(), submittedBy: userId, version: { increment: 1 } },
  });
}

async function verifyPurchase(id, userId) {
  const purchase = await getPurchaseById(id);
  assertStatus(purchase, 'SUBMITTED');

  return prisma.purchase.update({
    where: { id },
    data: { status: 'VERIFIED', verifiedAt: new Date(), verifiedById: userId, version: { increment: 1 } },
  });
}

/**
 * CRITICAL: Approval is atomic.
 * In a single transaction:
 *   1. Lock purchase row
 *   2. Validate status
 *   3. Set approval_operation_id (idempotency guard)
 *   4. Set status = APPROVED
 *   5. Create batches
 *   6. Create stock ledger PURCHASE_RECEIPT entries
 *   7. Set credit due date if applicable
 *
 * If called twice with same operationId → idempotency guard triggers.
 * If called twice with different operationId → status check blocks it.
 */
async function approvePurchase(id, operationId, userId) {
  return prisma.$transaction(
    async (tx) => {
      // Lock the purchase row to prevent concurrent approval
      const [purchase] = await tx.$queryRaw`
        SELECT * FROM purchases WHERE id = ${id}::uuid FOR UPDATE
      `;

      if (!purchase) throw new NotFoundError('Purchase', id);

      // Idempotency: same operationId was already used
      if (purchase.approvalOperationId === operationId) {
        return tx.purchase.findUnique({ where: { id }, include: { batches: true } });
      }

      // Block re-approval with different operation
      if (purchase.status === 'APPROVED') {
        throw new IdempotencyConflictError(operationId);
      }

      if (purchase.status !== 'VERIFIED') {
        throw new InvalidStatusTransitionError('Purchase', purchase.status, 'APPROVED');
      }

      // Determine credit due date
      let creditDueDate = null;
      if (purchase.creditTerms !== 'CASH') {
        const days = purchase.creditDueDays || getDefaultDays(purchase.creditTerms);
        creditDueDate = new Date(purchase.purchaseDate);
        creditDueDate.setDate(creditDueDate.getDate() + days);
      }

      // Set APPROVED
      await tx.purchase.update({
        where: { id },
        data: {
          status:              'APPROVED',
          approvedAt:          new Date(),
          approvedById:        userId,
          approvalOperationId: operationId,
          creditDueDate,
          version:             { increment: 1 },
        },
      });

      // Fetch items with coffee types
      const items = await tx.purchaseItem.findMany({
        where:   { purchaseId: id },
        include: { coffeeType: true },
      });

      // Create one batch per purchase item
      const createdBatches = [];
      for (const item of items) {
        const batchCode = await nextCode(prisma, 'batch', 'BAT');
        const costPerKg = item.unitPriceKg;
        const totalCost = item.totalPrice;

        const batch = await tx.batch.create({
          data: {
            id:             uuidv4(),
            batchCode,
            purchaseId:     id,
            purchaseItemId: item.id,
            coffeeTypeId:   item.coffeeTypeId,
            locationId:     purchase.locationId,
            originalKg:     item.quantityKg,
            remainingKg:    item.quantityKg,
            costPerKg,
            totalCost,
            status:         'ACTIVE',
            createdById:    userId,
            deviceId:       purchase.deviceId,
          },
        });

        // Create immutable stock ledger entry
        await inventoryEngine.createLedgerEntry(tx, {
          batchId:       batch.id,
          locationId:    purchase.locationId,
          quantityKg:    item.quantityKg,
          movementType:  'PURCHASE_RECEIPT',
          purchaseId:    id,
          performedById: userId,
          deviceId:      purchase.deviceId,
          operationId:   `${operationId}:item:${item.id}`,
          notes:         `Purchase receipt for ${item.quantityKg} KG`,
        });

        createdBatches.push(batch);
      }

      return { id, status: 'APPROVED', batches: createdBatches };
    },
    { isolationLevel: 'Serializable', timeout: 30_000 },
  );
}

async function rejectPurchase(id, reason, userId) {
  const purchase = await getPurchaseById(id);
  assertStatus(purchase, 'SUBMITTED', 'VERIFIED');

  return prisma.purchase.update({
    where: { id },
    data: {
      status: 'REJECTED',
      rejectedAt: new Date(),
      rejectedById: userId,
      rejectionReason: reason,
      version: { increment: 1 },
    },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDefaultDays(creditTerms) {
  const map = { NET_7: 7, NET_14: 14, NET_30: 30, NET_60: 60 };
  return map[creditTerms] || 0;
}

module.exports = {
  createPurchase,
  listPurchases,
  getPurchaseById,
  updatePurchase,
  submitPurchase,
  verifyPurchase,
  approvePurchase,
  rejectPurchase,
};
