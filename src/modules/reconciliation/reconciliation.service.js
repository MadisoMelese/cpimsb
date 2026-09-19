'use strict';

const { v4: uuidv4 } = require('uuid');
const prisma  = require('../../database/prismaClient');
const engine  = require('../inventory/inventory.engine');
const { nextCode } = require('../../common/utils/codeGenerator');
const { Decimal, subtract } = require('../../common/utils/decimal');
const {
  NotFoundError,
  BusinessRuleError,
  InvalidStatusTransitionError,
} = require('../../common/errors/AppError');

async function createSession(data, userId) {
  const sessionCode = await nextCode(prisma, 'reconciliation', 'REC');
  return prisma.reconciliationSession.create({
    data: {
      id:          uuidv4(),
      sessionCode,
      locationId:  data.locationId || null,
      periodStart: data.periodStart,
      periodEnd:   data.periodEnd,
      status:      'OPEN',
      notes:       data.notes || null,
      openedById:  userId,
    },
  });
}

async function listSessions(query) {
  const where = {};
  if (query.status)     where.status     = query.status;
  if (query.locationId) where.locationId = query.locationId;
  return prisma.reconciliationSession.findMany({
    where,
    orderBy: { openedAt: 'desc' },
    include: {
      location: true,
      openedBy: { select: { fullName: true } },
      _count: { select: { adjustments: true, verifications: true } },
    },
  });
}

async function getSessionById(id) {
  const session = await prisma.reconciliationSession.findUnique({
    where: { id },
    include: {
      location: true,
      openedBy:  { select: { fullName: true } },
      closedBy:  { select: { fullName: true } },
      verifications: {
        include: { reconciliationSession: false },
      },
      adjustments: true,
      lockedPeriods: true,
    },
  });
  if (!session) throw new NotFoundError('ReconciliationSession', id);
  return session;
}

/**
 * Record physical KG counts for each batch.
 * Computes system KG (from stock ledger) vs physical KG.
 */
async function recordVerifications(sessionId, { verifications }, userId) {
  const session = await getSessionById(sessionId);
  if (!['OPEN', 'PENDING_ADJUSTMENTS'].includes(session.status)) {
    throw new InvalidStatusTransitionError('ReconciliationSession', session.status, 'OPEN');
  }

  const results = [];
  for (const v of verifications) {
    let systemKg = new Decimal(0);

    if (v.batchId) {
      // Compute system KG from ledger
      const ledgerSum = await prisma.stockLedger.aggregate({
        where: { batchId: v.batchId },
        _sum: { quantityKg: true },
      });
      systemKg = new Decimal((ledgerSum._sum.quantityKg || 0).toString());
    } else {
      // General location-level count
      const where = {
        locationId: session.locationId,
        status: { in: ['ACTIVE', 'PARTIALLY_CONSUMED'] },
      };
      const batchSum = await prisma.batch.aggregate({ where, _sum: { remainingKg: true } });
      systemKg = new Decimal((batchSum._sum.remainingKg || 0).toString());
    }

    const physicalKg    = new Decimal(v.physicalKg.toString());
    const differenceKg  = subtract(physicalKg, systemKg);

    const verification = await prisma.reconciliationVerification.create({
      data: {
        id:                      uuidv4(),
        reconciliationSessionId: sessionId,
        batchId:                 v.batchId || null,
        systemKg:                systemKg.toFixed(3),
        physicalKg:              physicalKg.toFixed(3),
        differenceKg:            differenceKg.toFixed(3),
        notes:                   v.notes || null,
        verifiedById:            userId,
      },
    });
    results.push(verification);
  }

  // Move to PENDING_ADJUSTMENTS if there are discrepancies
  const hasDiscrepancies = results.some((r) => !new Decimal(r.differenceKg.toString()).isZero());
  if (hasDiscrepancies && session.status === 'OPEN') {
    await prisma.reconciliationSession.update({
      where: { id: sessionId },
      data: { status: 'PENDING_ADJUSTMENTS' },
    });
  }

  return results;
}

/**
 * Create stock adjustments to resolve discrepancies.
 */
async function createAdjustment(sessionId, data, userId) {
  const session = await getSessionById(sessionId);
  if (session.status === 'CLOSED') {
    throw new InvalidStatusTransitionError('ReconciliationSession', 'CLOSED', 'adjustment');
  }

  return prisma.$transaction(
    async (tx) =>
      engine.createStockAdjustment(tx, {
        batchId:                 data.batchId,
        direction:               data.direction,
        quantityKg:              data.quantityKg,
        reason:                  data.reason,
        reconciliationSessionId: sessionId,
        operationId:             data.operationId,
        userId,
        deviceId:                data.deviceId,
      }),
    { isolationLevel: 'Serializable', timeout: 15_000 },
  );
}

/**
 * Close reconciliation session — locks the period.
 * Cannot close while there are unresolved discrepancies without corresponding adjustments.
 */
async function closeSession(sessionId, { notes }, userId) {
  const session = await getSessionById(sessionId);

  if (session.status === 'CLOSED') {
    throw new InvalidStatusTransitionError('ReconciliationSession', 'CLOSED', 'CLOSED');
  }

  // Validate: every verification with a non-zero difference must have an adjustment
  for (const verification of session.verifications) {
    const diff = new Decimal(verification.differenceKg.toString());
    if (!diff.isZero()) {
      const adjustment = await prisma.stockAdjustment.findFirst({
        where: {
          batchId:                 verification.batchId,
          reconciliationSessionId: sessionId,
        },
      });
      if (!adjustment) {
        throw new BusinessRuleError(
          'UNRESOLVED_RECONCILIATION_DISCREPANCY',
          `Batch ${verification.batchId} has a discrepancy of ${diff.toFixed(3)} KG with no adjustment. ` +
            'All discrepancies must be resolved before closing.',
          { batchId: verification.batchId, differenceKg: diff.toFixed(3) },
        );
      }
    }
  }

  return prisma.$transaction(async (tx) => {
    // Close session
    const closed = await tx.reconciliationSession.update({
      where: { id: sessionId },
      data: {
        status:    'CLOSED',
        closedAt:  new Date(),
        closedById: userId,
        notes:     notes || session.notes,
      },
    });

    // Lock the period — prevents backdating of stock entries
    await tx.lockedPeriod.create({
      data: {
        id:                      uuidv4(),
        reconciliationSessionId: sessionId,
        locationId:              session.locationId || null,
        periodStart:             session.periodStart,
        periodEnd:               session.periodEnd,
        lockedById:              userId,
      },
    });

    return closed;
  });
}

module.exports = {
  createSession,
  listSessions,
  getSessionById,
  recordVerifications,
  createAdjustment,
  closeSession,
};
