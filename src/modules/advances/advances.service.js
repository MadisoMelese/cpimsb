'use strict';

/**
 * AGENT ADVANCE SYSTEM
 * ====================
 * The correct financial model for this project:
 *
 *   1. Admin gives cash ADVANCE to agent (daily / weekly / monthly)
 *   2. Agent goes to the field and buys coffee
 *   3. Agent reports back to Storekeeper:
 *      - Purchases (KG, price/KG) → recorded in purchases module
 *      - Other expenses (transport, bags, labour, etc.)
 *      - Remaining cash in hand
 *   4. Storekeeper records everything and submits for admin approval
 *   5. Admin approves → advance is marked ACCOUNTED
 *
 * Agent balance = Total Advances Given - Total Coffee Cost - Total Expenses - Cash Returned
 */

const { v4: uuidv4 } = require('uuid');
const prisma = require('../../database/prismaClient');
const { nextCode } = require('../../common/utils/codeGenerator');
const { Decimal, subtract, add, isGreaterThan } = require('../../common/utils/decimal');
const { NotFoundError, BusinessRuleError, InvalidStatusTransitionError } = require('../../common/errors/AppError');
const { paginate, paginatedResponse } = require('../../common/utils/pagination');

// ─── Give advance ─────────────────────────────────────────────────────────────

async function giveAdvance(data, userId) {
  const advanceNumber = await nextCode(prisma, 'advance', 'ADV');

  return prisma.agentAdvance.create({
    data: {
      id:            uuidv4(),
      advanceNumber,
      agentId:       data.agentId,
      amount:        data.amount,
      currency:      'ETB',
      advanceDate:   new Date(data.advanceDate),
      paymentMethod: data.paymentMethod,
      reference:     data.reference     || null,
      notes:         data.notes         || null,
      status:        'PENDING',
      operationId:   data.operationId,
      givenById:     userId,
    },
    include: { agent: { select: { id: true, name: true, code: true, phone: true } }, givenBy: { select: { fullName: true } } },
  });
}

// ─── List advances ────────────────────────────────────────────────────────────

async function listAdvances(query) {
  const page  = parseInt(query.page  || 1,  10);
  const limit = parseInt(query.limit || 50, 10);

  const where = {};
  if (query.agentId) where.agentId = query.agentId;
  if (query.status)  where.status  = query.status;
  if (query.startDate || query.endDate) {
    where.advanceDate = {};
    if (query.startDate) where.advanceDate.gte = new Date(query.startDate);
    if (query.endDate)   where.advanceDate.lte = new Date(query.endDate);
  }
  if (query.search) {
    where.OR = [
      { advanceNumber: { contains: query.search, mode: 'insensitive' } },
      { agent:         { name: { contains: query.search, mode: 'insensitive' } } },
      { agent:         { code: { contains: query.search, mode: 'insensitive' } } },
      { notes:         { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const [advances, total] = await prisma.$transaction([
    prisma.agentAdvance.findMany({
      where,
      ...paginate(page, limit),
      orderBy: { advanceDate: 'desc' },
      include: {
        agent:    { select: { id: true, name: true, code: true } },
        givenBy:  { select: { fullName: true } },
        expenses: true,
      },
    }),
    prisma.agentAdvance.count({ where }),
  ]);

  return paginatedResponse(advances, total, page, limit);
}

// ─── Get single advance with full detail ──────────────────────────────────────

async function getAdvanceById(id) {
  const advance = await prisma.agentAdvance.findUnique({
    where: { id },
    include: {
      agent:      { select: { id: true, name: true, code: true, phone: true } },
      givenBy:    { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
      expenses: {
        include: {
          purchase: { select: { purchaseNumber: true, purchaseDate: true } },
        },
        orderBy: { expenseDate: 'asc' },
      },
    },
  });
  if (!advance) throw new NotFoundError('AgentAdvance', id);
  return advance;
}

// ─── Add expense to advance ───────────────────────────────────────────────────

async function addExpense(advanceId, data) {
  const advance = await getAdvanceById(advanceId);

  if (advance.status === 'APPROVED' || advance.status === 'VOIDED') {
    throw new BusinessRuleError(
      'ADVANCE_LOCKED',
      `Cannot add expenses to a ${advance.status} advance`,
    );
  }

  const expense = await prisma.agentExpense.create({
    data: {
      id:          uuidv4(),
      advanceId,
      agentId:     advance.agentId,
      purchaseId:  data.purchaseId  || null,
      category:    data.category,
      amount:      data.amount,
      currency:    'ETB',
      description: data.description,
      receiptRef:  data.receiptRef  || null,
      expenseDate: new Date(data.expenseDate),
    },
  });

  return expense;
}

// ─── Record returned cash ─────────────────────────────────────────────────────

async function recordReturn(advanceId, data) {
  const advance = await getAdvanceById(advanceId);

  if (advance.status === 'APPROVED' || advance.status === 'VOIDED') {
    throw new BusinessRuleError('ADVANCE_LOCKED', `Cannot modify a ${advance.status} advance`);
  }

  return prisma.agentAdvance.update({
    where: { id: advanceId },
    data: {
      returnedAmount:  data.returnedAmount,
      returnedDate:    new Date(data.returnedDate),
      returnedMethod:  data.returnedMethod,
      returnReference: data.returnReference || null,
      version: { increment: 1 },
    },
  });
}

// ─── Submit for approval (Storekeeper action) ─────────────────────────────────

async function submitAdvance(advanceId) {
  const advance = await getAdvanceById(advanceId);
  if (advance.status !== 'PENDING') {
    throw new InvalidStatusTransitionError('AgentAdvance', advance.status, 'ACCOUNTED');
  }

  return prisma.agentAdvance.update({
    where: { id: advanceId },
    data:  { status: 'ACCOUNTED', version: { increment: 1 } },
  });
}

// ─── Approve (Admin action) ───────────────────────────────────────────────────

async function approveAdvance(advanceId, userId) {
  const advance = await getAdvanceById(advanceId);
  if (advance.status !== 'ACCOUNTED') {
    throw new InvalidStatusTransitionError('AgentAdvance', advance.status, 'APPROVED');
  }

  return prisma.agentAdvance.update({
    where: { id: advanceId },
    data:  { status: 'APPROVED', approvedById: userId, approvedAt: new Date(), version: { increment: 1 } },
  });
}

// ─── Void ─────────────────────────────────────────────────────────────────────

async function voidAdvance(advanceId, reason, userId) {
  const advance = await getAdvanceById(advanceId);
  if (advance.status === 'VOIDED') {
    throw new BusinessRuleError('ALREADY_VOIDED', 'Advance already voided');
  }
  return prisma.agentAdvance.update({
    where: { id: advanceId },
    data:  { status: 'VOIDED', voidedById: userId, voidedAt: new Date(), voidReason: reason, version: { increment: 1 } },
  });
}

// ─── Delete expense ───────────────────────────────────────────────────────────

async function deleteExpense(expenseId) {
  const expense = await prisma.agentExpense.findUnique({ where: { id: expenseId } });
  if (!expense) throw new NotFoundError('AgentExpense', expenseId);

  const advance = await prisma.agentAdvance.findUnique({ where: { id: expense.advanceId } });
  if (advance?.status === 'APPROVED' || advance?.status === 'VOIDED') {
    throw new BusinessRuleError('ADVANCE_LOCKED', 'Cannot delete expenses from a locked advance');
  }

  return prisma.agentExpense.delete({ where: { id: expenseId } });
}

// ─── Agent account summary ────────────────────────────────────────────────────

async function getAgentAccountSummary(agentId, { startDate, endDate } = {}) {
  const where = { agentId, status: { not: 'VOIDED' } };
  if (startDate || endDate) {
    where.advanceDate = {};
    if (startDate) where.advanceDate.gte = new Date(startDate);
    if (endDate)   where.advanceDate.lte = new Date(endDate);
  }

  const advances = await prisma.agentAdvance.findMany({
    where,
    include: { expenses: true },
    orderBy: { advanceDate: 'desc' },
  });

  let totalAdvanced   = new Decimal(0);
  let totalExpenses   = new Decimal(0);
  let totalReturned   = new Decimal(0);
  let coffeeCostTotal = new Decimal(0);
  let otherExpenses   = new Decimal(0);

  for (const adv of advances) {
    totalAdvanced = totalAdvanced.plus(adv.amount.toString());
    if (adv.returnedAmount) totalReturned = totalReturned.plus(adv.returnedAmount.toString());

    for (const exp of adv.expenses) {
      const amt = new Decimal(exp.amount.toString());
      totalExpenses = totalExpenses.plus(amt);
      if (exp.category === 'COFFEE_PURCHASE') coffeeCostTotal = coffeeCostTotal.plus(amt);
      else otherExpenses = otherExpenses.plus(amt);
    }
  }

  // balance = advanced - expenses - returned
  const balance = totalAdvanced.minus(totalExpenses).minus(totalReturned);

  return {
    agentId,
    advanceCount:    advances.length,
    totalAdvanced:   totalAdvanced.toFixed(2),
    totalExpenses:   totalExpenses.toFixed(2),
    coffeeCostTotal: coffeeCostTotal.toFixed(2),
    otherExpenses:   otherExpenses.toFixed(2),
    totalReturned:   totalReturned.toFixed(2),
    balance:         balance.toFixed(2),  // positive = agent still holds cash, negative = overspent
    advances,
  };
}

// ─── All agents account overview ──────────────────────────────────────────────

async function getAllAgentsAccountOverview({ startDate, endDate } = {}) {
  const agents = await prisma.agent.findMany({
    where:   { isSupplier: true, isActive: true },
    orderBy: { name: 'asc' },
  });

  const summaries = await Promise.all(
    agents.map(a => getAgentAccountSummary(a.id, { startDate, endDate })
      .then(s => ({ ...s, agentName: a.name, agentCode: a.code, phone: a.phone }))
    )
  );

  return summaries;
}

module.exports = {
  giveAdvance,
  listAdvances,
  getAdvanceById,
  addExpense,
  recordReturn,
  submitAdvance,
  approveAdvance,
  voidAdvance,
  deleteExpense,
  getAgentAccountSummary,
  getAllAgentsAccountOverview,
};
