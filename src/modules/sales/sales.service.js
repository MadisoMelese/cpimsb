'use strict';

const { v4: uuidv4 } = require('uuid');
const prisma   = require('../../database/prismaClient');
const engine   = require('../inventory/inventory.engine');
const { nextCode } = require('../../common/utils/codeGenerator');
const { multiply, subtract, add, Decimal } = require('../../common/utils/decimal');
const {
  NotFoundError,
  BusinessRuleError,
  InvalidStatusTransitionError,
  IdempotencyConflictError,
} = require('../../common/errors/AppError');
const { paginate, paginatedResponse } = require('../../common/utils/pagination');

async function createSale(data, userId) {
  const saleNumber = await nextCode(prisma, 'sale', 'SAL');

  return prisma.sale.create({
    data: {
      id:             uuidv4(),
      saleNumber,
      agentId:        data.agentId,
      locationId:     data.locationId || null,
      saleDate:       data.saleDate,
      status:         'DRAFT',
      creditTerms:    data.creditTerms || 'CASH',
      creditDueDays:  data.creditDueDays || null,
      currency:       data.currency || 'KES',
      notes:          data.notes || null,
      createdById:    userId,
      deviceId:       data.deviceId || null,
      items: {
        create: data.items.map((item) => {
          const saleAmount  = multiply(item.quantityKg, item.unitSalePrice).toFixed(2);
          // Cost will be filled at confirm time from batch — store placeholder
          return {
            id:            uuidv4(),
            batchId:       item.batchId,
            quantityKg:    item.quantityKg,
            unitSalePrice: item.unitSalePrice,
            saleAmount,
            unitCostKg:    0,  // placeholder — updated on confirm
            costAmount:    0,  // placeholder
            grossMargin:   0,  // placeholder
            notes:         item.notes || null,
          };
        }),
      },
    },
    include: { items: true, agent: true },
  });
}

async function listSales(query) {
  const { page, limit } = query;
  const where = {};
  if (query.status)  where.status  = query.status;
  if (query.agentId) where.agentId = query.agentId;
  if (query.startDate || query.endDate) {
    where.saleDate = {};
    if (query.startDate) where.saleDate.gte = new Date(query.startDate);
    if (query.endDate)   where.saleDate.lte = new Date(query.endDate);
  }
  if (query.search) {
    where.OR = [
      { saleNumber: { contains: query.search, mode: 'insensitive' } },
      { agent:      { name: { contains: query.search, mode: 'insensitive' } } },
      { notes:      { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const [sales, total] = await prisma.$transaction([
    prisma.sale.findMany({
      where,
      ...paginate(page, limit),
      orderBy: { saleDate: 'desc' },
      include: {
        agent: { select: { id: true, name: true, code: true } },
        items: { include: { batch: { include: { coffeeType: true } } } },
      },
    }),
    prisma.sale.count({ where }),
  ]);
  return paginatedResponse(sales, total, page, limit);
}

async function getSaleById(id) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      agent: true,
      items: {
        include: {
          batch: {
            include: {
              coffeeType: true,
              purchase: { select: { purchaseNumber: true } },
              processingRun: { select: { runCode: true } },
            },
          },
        },
      },
      payments: true,
      createdBy: { select: { fullName: true } },
    },
  });
  if (!sale) throw new NotFoundError('Sale', id);
  return sale;
}

/**
 * ATOMIC sale confirmation:
 *  1. Lock all referenced batches (SELECT FOR UPDATE)
 *  2. Validate all batch quantities
 *  3. Capture cost basis from each batch at point of sale
 *  4. Consume from each batch → stock ledger SALE_CONSUMPTION entries
 *  5. Calculate gross margin per line
 *  6. Update sale totals
 *  7. Set CONFIRMED
 */
async function confirmSale(id, operationId, userId) {
  const sale = await getSaleById(id);

  // Idempotency
  if (sale.confirmationOperationId === operationId) return sale;
  if (sale.status === 'CONFIRMED') throw new IdempotencyConflictError(operationId);
  if (sale.status !== 'DRAFT') {
    throw new InvalidStatusTransitionError('Sale', sale.status, 'CONFIRMED');
  }
  if (sale.items.length === 0) {
    throw new BusinessRuleError('SALE_NO_ITEMS', 'Cannot confirm a sale with no items');
  }

  return prisma.$transaction(
    async (tx) => {
      let totalKg          = new Decimal(0);
      let totalSaleAmount  = new Decimal(0);
      let totalCostAmount  = new Decimal(0);

      // Credit due date
      let creditDueDate = null;
      if (sale.creditTerms !== 'CASH') {
        const days = sale.creditDueDays || getDefaultDays(sale.creditTerms);
        creditDueDate = new Date(sale.saleDate);
        creditDueDate.setDate(creditDueDate.getDate() + days);
      }

      for (const item of sale.items) {
        const batch = item.batch;
        const qtyKg = new Decimal(item.quantityKg.toString());

        // Consume from batch (includes SELECT FOR UPDATE internally)
        await engine.consumeFromBatch(tx, {
          batchId:       item.batchId,
          quantityKg:    item.quantityKg,
          movementType:  'SALE_CONSUMPTION',
          sourceRef:     { saleId: id },
          performedById: userId,
          operationId:   `${operationId}:item:${item.id}`,
          notes:         `Sale ${sale.saleNumber}`,
        });

        // Capture cost from batch at time of sale (specific batch costing strategy)
        const unitCostKg   = new Decimal(batch.costPerKg.toString());
        const costAmount   = multiply(unitCostKg, qtyKg);
        const saleAmount   = new Decimal(item.saleAmount.toString());
        const grossMargin  = subtract(saleAmount, costAmount);

        // Update sale item with captured costs
        await tx.saleItem.update({
          where: { id: item.id },
          data: {
            unitCostKg:  unitCostKg.toFixed(4),
            costAmount:  costAmount.toFixed(2),
            grossMargin: grossMargin.toFixed(2),
          },
        });

        totalKg         = add(totalKg, qtyKg);
        totalSaleAmount = add(totalSaleAmount, saleAmount);
        totalCostAmount = add(totalCostAmount, costAmount);
      }

      const grossMargin = subtract(totalSaleAmount, totalCostAmount);

      const confirmed = await tx.sale.update({
        where: { id },
        data: {
          status:                  'CONFIRMED',
          confirmedAt:             new Date(),
          confirmedById:           userId,
          confirmationOperationId: operationId,
          creditDueDate,
          totalKg:                 totalKg.toFixed(3),
          totalSaleAmount:         totalSaleAmount.toFixed(2),
          totalCostAmount:         totalCostAmount.toFixed(2),
          grossMargin:             grossMargin.toFixed(2),
          version:                 { increment: 1 },
        },
        include: { items: true },
      });

      return confirmed;
    },
    { isolationLevel: 'Serializable', timeout: 30_000 },
  );
}

async function cancelSale(id, userId) {
  const sale = await getSaleById(id);
  if (sale.status === 'CONFIRMED') {
    throw new BusinessRuleError(
      'CANNOT_CANCEL_CONFIRMED_SALE',
      'Confirmed sales cannot be cancelled directly. Create a return/adjustment.',
    );
  }
  return prisma.sale.update({
    where: { id },
    data: { status: 'CANCELLED', version: { increment: 1 } },
  });
}

function getDefaultDays(creditTerms) {
  const map = { NET_7: 7, NET_14: 14, NET_30: 30, NET_60: 60 };
  return map[creditTerms] || 0;
}

module.exports = { createSale, listSales, getSaleById, confirmSale, cancelSale };
