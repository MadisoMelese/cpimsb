'use strict';

const prisma = require('../../database/prismaClient');
const { NotFoundError, ConflictError, BusinessRuleError } = require('../../common/errors/AppError');
const { paginate, paginatedResponse } = require('../../common/utils/pagination');

async function createAgent(data) {
  const existing = await prisma.agent.findUnique({ where: { code: data.code } });
  if (existing) throw new ConflictError('DUPLICATE_AGENT_CODE', `Agent code ${data.code} already in use`);
  return prisma.agent.create({ data });
}

async function listAgents(query) {
  const page  = parseInt(query.page  || 1,   10);
  const limit = parseInt(query.limit || 100, 10);

  const where = {};
  // allow listing inactive too — let caller decide with ?includeInactive=true
  if (query.includeInactive !== 'true') where.isActive = true;
  if (query.isSupplier !== undefined) where.isSupplier = query.isSupplier === 'true';
  if (query.isCustomer !== undefined) where.isCustomer = query.isCustomer === 'true';
  if (query.search) {
    where.OR = [
      { name:    { contains: query.search, mode: 'insensitive' } },
      { code:    { contains: query.search, mode: 'insensitive' } },
      { phone:   { contains: query.search } },
      { email:   { contains: query.search, mode: 'insensitive' } },
      { address: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const [agents, total] = await prisma.$transaction([
    prisma.agent.findMany({ where, ...paginate(page, limit), orderBy: { name: 'asc' } }),
    prisma.agent.count({ where }),
  ]);
  return paginatedResponse(agents, total, page, limit);
}

async function getAgentById(id) {
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) throw new NotFoundError('Agent', id);
  return agent;
}

/**
 * Get an agent with full stats: total purchases, total KG, total money,
 * payment balance, and recent purchase history.
 */
async function getAgentWithStats(id) {
  const agent = await getAgentById(id);

  const purchases = await prisma.purchase.findMany({
    where:   { agentId: id, status: 'APPROVED' },
    include: {
      items:    { include: { coffeeType: true } },
      payments: { where: { status: 'COMPLETED' }, select: { amount: true } },
      location: { select: { name: true } },
    },
    orderBy: { purchaseDate: 'desc' },
  });

  let totalKg = 0, totalMoney = 0, totalPaid = 0;
  for (const p of purchases) {
    totalKg    += p.items.reduce((a, i) => a + parseFloat(i.quantityKg), 0);
    totalMoney += p.items.reduce((a, i) => a + parseFloat(i.totalPrice), 0);
    totalPaid  += p.payments.reduce((a, py) => a + parseFloat(py.amount), 0);
  }

  return {
    ...agent,
    stats: {
      purchaseCount: purchases.length,
      totalKg:       totalKg.toFixed(3),
      totalMoney:    totalMoney.toFixed(2),
      totalPaid:     totalPaid.toFixed(2),
      balance:       (totalMoney - totalPaid).toFixed(2),
      avgPriceKg:    totalKg > 0 ? (totalMoney / totalKg).toFixed(2) : '0.00',
    },
    recentPurchases: purchases.slice(0, 10),
  };
}

async function updateAgent(id, data) {
  await getAgentById(id);

  // If code is being changed, check no duplicate
  if (data.code) {
    const existing = await prisma.agent.findFirst({ where: { code: data.code, id: { not: id } } });
    if (existing) throw new ConflictError('DUPLICATE_AGENT_CODE', `Agent code ${data.code} already in use`);
  }

  return prisma.agent.update({
    where: { id },
    data:  { ...data, version: { increment: 1 } },
  });
}

async function updatePhoto(id, photoUrl) {
  await getAgentById(id);
  return prisma.agent.update({
    where: { id },
    data:  { photoUrl, version: { increment: 1 } },
  });
}

async function activateAgent(id) {
  await getAgentById(id);
  return prisma.agent.update({ where: { id }, data: { isActive: true, version: { increment: 1 } } });
}

async function deactivateAgent(id) {
  await getAgentById(id);
  return prisma.agent.update({ where: { id }, data: { isActive: false, version: { increment: 1 } } });
}

/**
 * Hard delete — only allowed if agent has NO approved purchases.
 * Agents with history should be deactivated, not deleted.
 */
async function deleteAgent(id) {
  await getAgentById(id);

  const purchaseCount = await prisma.purchase.count({ where: { agentId: id } });
  if (purchaseCount > 0) {
    throw new BusinessRuleError(
      'AGENT_HAS_HISTORY',
      `Cannot delete agent — they have ${purchaseCount} purchase record(s). Deactivate instead.`,
      { purchaseCount },
    );
  }

  return prisma.agent.delete({ where: { id } });
}

module.exports = {
  createAgent,
  listAgents,
  getAgentById,
  getAgentWithStats,
  updateAgent,
  updatePhoto,
  activateAgent,
  deactivateAgent,
  deleteAgent,
};
