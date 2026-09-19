'use strict';

const prisma = require('../../database/prismaClient');

// ─── helpers ──────────────────────────────────────────────────────────────────

function purchaseDateWhere(startDate, endDate) {
  if (!startDate && !endDate) return undefined;
  const w = {};
  if (startDate) w.gte = new Date(startDate);
  if (endDate)   w.lte = new Date(endDate);
  return w;
}

function sumKg(items)    { return items.reduce((a, i) => a + parseFloat(i.quantityKg  || 0), 0); }
function sumPrice(items) { return items.reduce((a, i) => a + parseFloat(i.totalPrice  || 0), 0); }
function sumPaid(pays)   { return pays.reduce( (a, p) => a + parseFloat(p.amount      || 0), 0); }

// ─── Daily Purchase Report ────────────────────────────────────────────────────

async function dailyPurchaseReport({ startDate, endDate, agentId, locationId }) {
  const where = { status: 'APPROVED' };
  const dtWhere = purchaseDateWhere(startDate, endDate);
  if (dtWhere)    where.purchaseDate = dtWhere;
  if (agentId)    where.agentId    = agentId;
  if (locationId) where.locationId = locationId;

  const purchases = await prisma.purchase.findMany({
    where,
    include: {
      agent:    { select: { id: true, name: true, code: true, phone: true } },
      location: { select: { id: true, name: true, code: true } },
      items:    { include: { coffeeType: true } },
      payments: { where: { status: 'COMPLETED' }, select: { amount: true } },
    },
    orderBy: { purchaseDate: 'desc' },
  });

  let totalKg = 0, totalMoney = 0, totalCash = 0, totalCredit = 0;
  const agentMap = {}, locationMap = {}, gradeMap = {}, typeMap = {};
  const wetDrySplit = { wet: 0, dry: 0, other: 0 };

  for (const p of purchases) {
    const itemTotal = sumPrice(p.items);
    const isCredit  = p.creditTerms !== 'CASH';

    totalMoney += itemTotal;
    if (isCredit) totalCredit += itemTotal; else totalCash += itemTotal;

    // ── by agent
    if (!agentMap[p.agentId]) {
      agentMap[p.agentId] = { agentId: p.agentId, agentName: p.agent.name, agentCode: p.agent.code, totalKg: 0, totalMoney: 0, purchaseCount: 0 };
    }
    agentMap[p.agentId].purchaseCount++;
    agentMap[p.agentId].totalMoney += itemTotal;

    // ── by location
    if (!locationMap[p.locationId]) {
      locationMap[p.locationId] = { locationId: p.locationId, locationName: p.location.name, totalKg: 0, totalMoney: 0, purchaseCount: 0 };
    }
    locationMap[p.locationId].purchaseCount++;
    locationMap[p.locationId].totalMoney += itemTotal;

    for (const item of p.items) {
      const kg = parseFloat(item.quantityKg);
      totalKg += kg;

      agentMap[p.agentId].totalKg    += kg;
      locationMap[p.locationId].totalKg += kg;

      const state = item.coffeeType.state;
      const grade = item.coffeeType.grade || 'N/A';

      // wet/dry split
      if (state === 'WET') wetDrySplit.wet += kg;
      else if (['DRY', 'HULLED', 'SORTED', 'GRADED'].includes(state)) wetDrySplit.dry += kg;
      else wetDrySplit.other += kg;

      // by grade
      if (!gradeMap[grade]) gradeMap[grade] = { grade, totalKg: 0, totalMoney: 0 };
      gradeMap[grade].totalKg    += kg;
      gradeMap[grade].totalMoney += parseFloat(item.totalPrice);

      // by coffee type
      const ctKey = item.coffeeTypeId;
      if (!typeMap[ctKey]) {
        typeMap[ctKey] = { coffeeTypeId: ctKey, coffeeTypeName: item.coffeeType.name, grade, state, totalKg: 0, totalMoney: 0 };
      }
      typeMap[ctKey].totalKg    += kg;
      typeMap[ctKey].totalMoney += parseFloat(item.totalPrice);
    }
  }

  // format aggregates
  const fmt = (n, d = 2) => Number(n).toFixed(d);

  return {
    summary: {
      totalKg:        fmt(totalKg, 3),
      totalMoney:     fmt(totalMoney),
      averagePriceKg: totalKg > 0 ? fmt(totalMoney / totalKg) : '0.00',
      totalCash:      fmt(totalCash),
      totalCredit:    fmt(totalCredit),
      wetKg:          fmt(wetDrySplit.wet, 3),
      dryKg:          fmt(wetDrySplit.dry, 3),
      purchaseCount:  purchases.length,
    },
    byAgent:    Object.values(agentMap).map(a => ({ ...a, totalKg: fmt(a.totalKg, 3), totalMoney: fmt(a.totalMoney), avgPriceKg: a.totalKg > 0 ? fmt(a.totalMoney / a.totalKg) : '0.00' })),
    byLocation: Object.values(locationMap).map(l => ({ ...l, totalKg: fmt(l.totalKg, 3), totalMoney: fmt(l.totalMoney) })),
    byGrade:    Object.values(gradeMap).map(g => ({ ...g, totalKg: fmt(g.totalKg, 3), totalMoney: fmt(g.totalMoney) })),
    byType:     Object.values(typeMap).map(t => ({ ...t, totalKg: fmt(t.totalKg, 3), totalMoney: fmt(t.totalMoney) })),
    purchases,
  };
}

// ─── Agent Overview Performance ───────────────────────────────────────────────

async function agentPerformanceReport({ startDate, endDate, agentId }) {
  const dtWhere = purchaseDateWhere(startDate, endDate);
  const purchaseWhere = { status: 'APPROVED', ...(dtWhere ? { purchaseDate: dtWhere } : {}) };
  if (agentId) purchaseWhere.agentId = agentId;

  const agents = await prisma.agent.findMany({
    where:   { isSupplier: true, isActive: true },
    include: {
      purchases: {
        where:   purchaseWhere,
        include: {
          items:    { include: { coffeeType: true } },
          location: { select: { id: true, name: true, code: true } },
          payments: { where: { status: 'COMPLETED' }, select: { amount: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  return agents.map(a => {
    const allItems   = a.purchases.flatMap(p => p.items);
    const totalKg    = sumKg(allItems);
    const totalMoney = sumPrice(allItems);

    // Balance only applies to credit purchases — CASH purchases are paid on delivery
    const creditPurchases = a.purchases.filter(p => p.creditTerms !== 'CASH');
    const creditMoney     = sumPrice(creditPurchases.flatMap(p => p.items));
    const totalPaid       = sumPaid(a.purchases.flatMap(p => p.payments));
    const balance         = creditMoney - totalPaid;

    // KG by grade
    const byGrade = {};
    // KG by type
    const byType  = {};
    // KG by location
    const byLocation = {};
    // wet vs dry
    let wetKg = 0, dryKg = 0;

    for (const p of a.purchases) {
      const locKey = p.locationId;
      if (!byLocation[locKey]) byLocation[locKey] = { locationName: p.location.name, totalKg: 0, totalMoney: 0, purchaseCount: 0 };
      byLocation[locKey].purchaseCount++;

      for (const item of p.items) {
        const kg    = parseFloat(item.quantityKg);
        const price = parseFloat(item.totalPrice);
        const grade = item.coffeeType.grade || 'N/A';
        const state = item.coffeeType.state;

        if (!byGrade[grade]) byGrade[grade] = { grade, totalKg: 0, totalMoney: 0 };
        byGrade[grade].totalKg    += kg;
        byGrade[grade].totalMoney += price;

        const ctKey = item.coffeeTypeId;
        if (!byType[ctKey]) byType[ctKey] = { coffeeTypeName: item.coffeeType.name, grade, state, totalKg: 0, totalMoney: 0 };
        byType[ctKey].totalKg    += kg;
        byType[ctKey].totalMoney += price;

        byLocation[locKey].totalKg    += kg;
        byLocation[locKey].totalMoney += price;

        if (state === 'WET') wetKg += kg; else dryKg += kg;
      }
    }

    return {
      agentId:       a.id,
      agentCode:     a.code,
      agentName:     a.name,
      phone:         a.phone,
      address:       a.address,
      purchaseCount: a.purchases.length,
      totalKg:       totalKg.toFixed(3),
      totalMoney:    totalMoney.toFixed(2),
      totalPaid:     totalPaid.toFixed(2),
      balance:       balance.toFixed(2),
      avgPriceKg:    totalKg > 0 ? (totalMoney / totalKg).toFixed(2) : '0.00',
      wetKg:         wetKg.toFixed(3),
      dryKg:         dryKg.toFixed(3),
      byGrade:    Object.values(byGrade).map(g => ({ ...g, totalKg: g.totalKg.toFixed(3), totalMoney: g.totalMoney.toFixed(2) })),
      byType:     Object.values(byType).map(t => ({ ...t, totalKg: t.totalKg.toFixed(3), totalMoney: t.totalMoney.toFixed(2) })),
      byLocation: Object.values(byLocation).map(l => ({ ...l, totalKg: l.totalKg.toFixed(3), totalMoney: l.totalMoney.toFixed(2) })),
    };
  });
}

// ─── Individual Agent Full Report (printable) ─────────────────────────────────

async function individualAgentReport(agentId, { startDate, endDate } = {}) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const dtWhere = purchaseDateWhere(startDate, endDate);
  const purchaseWhere = {
    agentId,
    status: 'APPROVED',
    ...(dtWhere ? { purchaseDate: dtWhere } : {}),
  };

  const purchases = await prisma.purchase.findMany({
    where:   purchaseWhere,
    include: {
      location: { select: { id: true, name: true, code: true } },
      items:    { include: { coffeeType: true } },
      payments: { where: { status: 'COMPLETED' } },
      createdBy:  { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
    },
    orderBy: { purchaseDate: 'desc' },
  });

  // ── aggregate across all purchases
  let totalKg = 0, totalMoney = 0, totalPaid = 0;
  const byGrade = {}, byType = {}, byLocation = {}, byDate = {};
  let wetKg = 0, dryKg = 0;

  const purchaseSummaries = purchases.map(p => {
    const pKg     = sumKg(p.items);
    const pMoney  = sumPrice(p.items);
    const pPaid   = sumPaid(p.payments);
    // CASH purchases are paid on delivery — balance is always 0
    const pCredit = p.creditTerms !== 'CASH' ? pMoney : 0;
    const balance = pCredit - pPaid;

    totalKg    += pKg;
    totalMoney += pMoney;
    totalPaid  += pPaid;

    // date grouping (YYYY-MM)
    const month = new Date(p.purchaseDate).toISOString().slice(0, 7);
    if (!byDate[month]) byDate[month] = { month, totalKg: 0, totalMoney: 0, purchaseCount: 0 };
    byDate[month].purchaseCount++;
    byDate[month].totalKg    += pKg;
    byDate[month].totalMoney += pMoney;

    // location
    const locKey = p.locationId;
    if (!byLocation[locKey]) byLocation[locKey] = { locationName: p.location.name, totalKg: 0, totalMoney: 0, purchaseCount: 0 };
    byLocation[locKey].purchaseCount++;
    byLocation[locKey].totalKg    += pKg;
    byLocation[locKey].totalMoney += pMoney;

    for (const item of p.items) {
      const kg    = parseFloat(item.quantityKg);
      const price = parseFloat(item.totalPrice);
      const grade = item.coffeeType.grade || 'N/A';
      const state = item.coffeeType.state;

      if (!byGrade[grade]) byGrade[grade] = { grade, totalKg: 0, totalMoney: 0 };
      byGrade[grade].totalKg    += kg;
      byGrade[grade].totalMoney += price;

      const ctKey = item.coffeeTypeId;
      if (!byType[ctKey]) byType[ctKey] = { coffeeTypeName: item.coffeeType.name, grade, state, totalKg: 0, totalMoney: 0 };
      byType[ctKey].totalKg    += kg;
      byType[ctKey].totalMoney += price;

      if (state === 'WET') wetKg += kg; else dryKg += kg;
    }

    return {
      purchaseId:     p.id,
      purchaseNumber: p.purchaseNumber,
      purchaseDate:   p.purchaseDate,
      locationName:   p.location.name,
      creditTerms:    p.creditTerms,
      creditDueDate:  p.creditDueDate,
      approvedBy:     p.approvedBy?.fullName || '—',
      receivedBy:     p.createdBy?.fullName  || '—',
      totalKg:        pKg.toFixed(3),
      totalMoney:     pMoney.toFixed(2),
      totalPaid:      pPaid.toFixed(2),
      balance:        balance.toFixed(2),
      isPaid:         balance <= 0,
      items: p.items.map(item => ({
        coffeeTypeName: item.coffeeType.name,
        grade:          item.coffeeType.grade || 'N/A',
        state:          item.coffeeType.state,
        quantityKg:     parseFloat(item.quantityKg).toFixed(3),
        unitPriceKg:    parseFloat(item.unitPriceKg).toFixed(2),
        totalPrice:     parseFloat(item.totalPrice).toFixed(2),
        moistureContent: item.moistureContent ? parseFloat(item.moistureContent).toFixed(1) : null,
      })),
      payments: p.payments.map(pay => ({
        paymentDate:   pay.paymentDate,
        amount:        parseFloat(pay.amount).toFixed(2),
        paymentMethod: pay.paymentMethod,
        reference:     pay.reference,
      })),
    };
  });

  const balance = totalMoney - totalPaid;

  return {
    agent: {
      id:      agent.id,
      code:    agent.code,
      name:    agent.name,
      phone:   agent.phone,
      address: agent.address,
    },
    period: {
      startDate: startDate || null,
      endDate:   endDate   || null,
    },
    summary: {
      purchaseCount: purchases.length,
      totalKg:       totalKg.toFixed(3),
      wetKg:         wetKg.toFixed(3),
      dryKg:         dryKg.toFixed(3),
      totalMoney:    totalMoney.toFixed(2),
      totalPaid:     totalPaid.toFixed(2),
      balance:       balance.toFixed(2),
      avgPriceKg:    totalKg > 0 ? (totalMoney / totalKg).toFixed(2) : '0.00',
    },
    byGrade:    Object.values(byGrade).map(g => ({ ...g, totalKg: g.totalKg.toFixed(3), totalMoney: g.totalMoney.toFixed(2) })),
    byType:     Object.values(byType).map(t => ({ ...t, totalKg: t.totalKg.toFixed(3), totalMoney: t.totalMoney.toFixed(2) })),
    byLocation: Object.values(byLocation).map(l => ({ ...l, totalKg: l.totalKg.toFixed(3), totalMoney: l.totalMoney.toFixed(2) })),
    byMonth:    Object.values(byDate).sort((a, b) => a.month.localeCompare(b.month)).map(d => ({ ...d, totalKg: d.totalKg.toFixed(3), totalMoney: d.totalMoney.toFixed(2) })),
    purchases:  purchaseSummaries,
  };
}

// ─── Reconciliation Report ────────────────────────────────────────────────────

async function reconciliationReport(sessionId) {
  const session = await prisma.reconciliationSession.findUnique({
    where:   { id: sessionId },
    include: { verifications: true, adjustments: true, location: true },
  });
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const { periodStart, periodEnd, locationId } = session;

  const [openingRes, purchaseRes, procInRes, procOutRes, saleRes] = await Promise.all([
    prisma.$queryRaw`SELECT COALESCE(SUM(sl."quantityKg"), 0) AS kg FROM stock_ledger sl WHERE sl."postedAt" < ${periodStart} AND (${locationId}::uuid IS NULL OR sl."locationId" = ${locationId}::uuid)`,
    prisma.$queryRaw`SELECT COALESCE(SUM("quantityKg"), 0) AS kg FROM stock_ledger WHERE "movementType" = 'PURCHASE_RECEIPT'      AND "postedAt" BETWEEN ${periodStart} AND ${periodEnd} AND (${locationId}::uuid IS NULL OR "locationId" = ${locationId}::uuid)`,
    prisma.$queryRaw`SELECT COALESCE(SUM(ABS("quantityKg")), 0) AS kg FROM stock_ledger WHERE "movementType" = 'PROCESSING_CONSUMPTION' AND "postedAt" BETWEEN ${periodStart} AND ${periodEnd} AND (${locationId}::uuid IS NULL OR "locationId" = ${locationId}::uuid)`,
    prisma.$queryRaw`SELECT COALESCE(SUM("quantityKg"), 0) AS kg FROM stock_ledger WHERE "movementType" = 'PROCESSING_OUTPUT'     AND "postedAt" BETWEEN ${periodStart} AND ${periodEnd} AND (${locationId}::uuid IS NULL OR "locationId" = ${locationId}::uuid)`,
    prisma.$queryRaw`SELECT COALESCE(SUM(ABS("quantityKg")), 0) AS kg FROM stock_ledger WHERE "movementType" = 'SALE_CONSUMPTION'      AND "postedAt" BETWEEN ${periodStart} AND ${periodEnd} AND (${locationId}::uuid IS NULL OR "locationId" = ${locationId}::uuid)`,
  ]);

  const openingKg         = parseFloat(openingRes[0]?.kg  || 0);
  const purchaseKg        = parseFloat(purchaseRes[0]?.kg || 0);
  const processingInputKg = parseFloat(procInRes[0]?.kg   || 0);
  const processingOutputKg= parseFloat(procOutRes[0]?.kg  || 0);
  const salesKg           = parseFloat(saleRes[0]?.kg     || 0);

  const adjKg = session.adjustments.reduce((acc, a) => {
    const qty = parseFloat(a.quantityKg);
    return a.direction === 'INCREASE' ? acc + qty : acc - qty;
  }, 0);

  const expectedClosingKg = openingKg + purchaseKg + processingOutputKg - processingInputKg - salesKg + adjKg;
  const physicalKg  = session.verifications.reduce((acc, v) => acc + parseFloat(v.physicalKg), 0);
  const discrepancy = physicalKg - expectedClosingKg;

  return {
    session:   { id: session.id, sessionCode: session.sessionCode, location: session.location?.name || 'All', periodStart: session.periodStart, periodEnd: session.periodEnd, status: session.status },
    movements: { openingKg: openingKg.toFixed(3), purchaseKg: purchaseKg.toFixed(3), processingInputKg: processingInputKg.toFixed(3), processingOutputKg: processingOutputKg.toFixed(3), salesKg: salesKg.toFixed(3), adjustmentKg: adjKg.toFixed(3), expectedClosingKg: expectedClosingKg.toFixed(3) },
    verification: { physicalKg: physicalKg.toFixed(3), discrepancy: discrepancy.toFixed(3) },
    adjustments: session.adjustments,
  };
}

// ─── Processing Loss Report ───────────────────────────────────────────────────

async function processingLossReport({ startDate, endDate }) {
  const where = { status: 'COMPLETED' };
  const dtWhere = purchaseDateWhere(startDate, endDate);
  if (dtWhere) where.completedAt = dtWhere;

  const runs = await prisma.processingRun.findMany({
    where,
    include: {
      inputs:       { include: { batch: { include: { coffeeType: true } } } },
      outputBatches:{ include: { coffeeType: true } },
    },
    orderBy: { completedAt: 'desc' },
  });

  const summary = {
    totalRuns:      runs.length,
    totalInputKg:   runs.reduce((a, r) => a + parseFloat(r.totalInputKg  || 0), 0).toFixed(3),
    totalOutputKg:  runs.reduce((a, r) => a + parseFloat(r.totalOutputKg || 0), 0).toFixed(3),
    totalLossKg:    runs.reduce((a, r) => a + parseFloat(r.lossKg        || 0), 0).toFixed(3),
    outOfRangeCount:runs.filter(r => r.lossOutOfRange).length,
  };
  return { summary, runs };
}

// ─── Payment Report ───────────────────────────────────────────────────────────

async function paymentReport({ startDate, endDate }) {
  const where = {};
  const dtWhere = purchaseDateWhere(startDate, endDate);
  if (dtWhere) where.paymentDate = dtWhere;

  const [purchasePayments, saleReceipts] = await prisma.$transaction([
    prisma.payment.findMany({ where: { ...where, paymentType: 'PURCHASE_PAYMENT', status: 'COMPLETED' }, include: { purchase: { select: { purchaseNumber: true, agent: { select: { name: true } } } } }, orderBy: { paymentDate: 'desc' } }),
    prisma.payment.findMany({ where: { ...where, paymentType: 'SALE_RECEIPT',     status: 'COMPLETED' }, include: { sale:     { select: { saleNumber:    true, agent: { select: { name: true } } } } }, orderBy: { paymentDate: 'desc' } }),
  ]);

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const overduePurchases = await prisma.purchase.findMany({
    where: { status: 'APPROVED', creditDueDate: { lt: today }, creditTerms: { not: 'CASH' } },
    select: { purchaseNumber: true, creditDueDate: true, agent: { select: { name: true } }, items: { select: { totalPrice: true } }, payments: { where: { status: 'COMPLETED' }, select: { amount: true } } },
  });

  const overdue = overduePurchases.map(p => {
    const total = sumPrice(p.items), paid = sumPaid(p.payments);
    return { purchaseNumber: p.purchaseNumber, agentName: p.agent?.name, creditDueDate: p.creditDueDate, remainingAmount: (total - paid).toFixed(2) };
  }).filter(p => parseFloat(p.remainingAmount) > 0);

  const outstandingPurchases = await prisma.purchase.findMany({
    where: { status: 'APPROVED', creditTerms: { not: 'CASH' } },
    select: { purchaseNumber: true, creditDueDate: true, agent: { select: { name: true } }, items: { select: { totalPrice: true } }, payments: { where: { status: 'COMPLETED' }, select: { amount: true } } },
  });

  const outstanding = outstandingPurchases.map(p => {
    const total = sumPrice(p.items), paid = sumPaid(p.payments);
    return { purchaseNumber: p.purchaseNumber, agentName: p.agent?.name, creditDueDate: p.creditDueDate, remainingAmount: (total - paid).toFixed(2) };
  }).filter(p => parseFloat(p.remainingAmount) > 0);

  return {
    summary: {
      totalPurchasePayments: sumPaid(purchasePayments).toFixed(2),
      totalSaleReceipts:     sumPaid(saleReceipts).toFixed(2),
      overdueCount:          overdue.length,
      outstandingCount:      outstanding.length,
    },
    purchasePayments, saleReceipts, overdue, outstanding,
  };
}

// ─── Credit Report ────────────────────────────────────────────────────────────

async function creditReport() {
  const purchases = await prisma.purchase.findMany({
    where: { status: 'APPROVED', creditTerms: { not: 'CASH' } },
    select: { purchaseNumber: true, creditDueDate: true, agentId: true, agent: { select: { name: true } }, items: { select: { totalPrice: true } }, payments: { where: { status: 'COMPLETED' }, select: { amount: true } } },
    orderBy: { creditDueDate: 'asc' },
  });

  const purchaseCredit = purchases.map(p => {
    const total = sumPrice(p.items), paid = sumPaid(p.payments);
    return { purchaseNumber: p.purchaseNumber, agentName: p.agent?.name, creditDueDate: p.creditDueDate, totalAmount: total.toFixed(2), totalPaid: paid.toFixed(2), remainingAmount: (total - paid).toFixed(2) };
  }).filter(p => parseFloat(p.remainingAmount) > 0);

  const sales = await prisma.sale.findMany({
    where: { status: 'CONFIRMED', creditTerms: { not: 'CASH' } },
    select: { saleNumber: true, creditDueDate: true, totalSaleAmount: true, agent: { select: { name: true } }, payments: { where: { status: 'COMPLETED' }, select: { amount: true } } },
    orderBy: { creditDueDate: 'asc' },
  });

  const saleCredit = sales.map(s => {
    const total = parseFloat(s.totalSaleAmount || 0), paid = sumPaid(s.payments);
    return { saleNumber: s.saleNumber, agentName: s.agent?.name, creditDueDate: s.creditDueDate, totalAmount: total.toFixed(2), totalReceived: paid.toFixed(2), remainingAmount: (total - paid).toFixed(2) };
  }).filter(s => parseFloat(s.remainingAmount) > 0);

  return { purchaseCredit, saleCredit };
}

module.exports = {
  dailyPurchaseReport,
  agentPerformanceReport,
  individualAgentReport,
  reconciliationReport,
  processingLossReport,
  paymentReport,
  creditReport,
};
