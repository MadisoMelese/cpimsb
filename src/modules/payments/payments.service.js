'use strict';

const { v4: uuidv4 } = require('uuid');
const prisma  = require('../../database/prismaClient');
const { nextCode } = require('../../common/utils/codeGenerator');
const { add, subtract, isGreaterThan, Decimal } = require('../../common/utils/decimal');
const {
  NotFoundError,
  BusinessRuleError,
  IdempotencyConflictError,
  OverpaymentError,
} = require('../../common/errors/AppError');

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function getTotalForTransaction(tx, type, id) {
  if (type === 'purchase') {
    const items = await tx.purchaseItem.aggregate({
      where: { purchaseId: id },
      _sum: { totalPrice: true },
    });
    return new Decimal((items._sum.totalPrice || 0).toString());
  }
  if (type === 'sale') {
    const sale = await tx.sale.findUnique({ where: { id }, select: { totalSaleAmount: true } });
    return new Decimal((sale?.totalSaleAmount || 0).toString());
  }
  return new Decimal(0);
}

async function getTotalPaid(tx, type, id) {
  const where = {
    status: 'COMPLETED',
    ...(type === 'purchase' ? { purchaseId: id } : { saleId: id }),
  };
  const result = await tx.payment.aggregate({ where, _sum: { amount: true } });
  return new Decimal((result._sum.amount || 0).toString());
}

// ─── Create payment ───────────────────────────────────────────────────────────

async function createPurchasePayment(purchaseId, data, userId) {
  return _createPayment('purchase', purchaseId, data, userId);
}

async function createSalePayment(saleId, data, userId) {
  return _createPayment('sale', saleId, data, userId);
}

async function _createPayment(type, transactionId, data, userId) {
  // Idempotency check
  const existing = await prisma.payment.findUnique({ where: { operationId: data.operationId } });
  if (existing) return { alreadyApplied: true, payment: existing };

  return prisma.$transaction(
    async (tx) => {
      // Lock the parent transaction
      let lockQuery;
      if (type === 'purchase') {
        lockQuery = tx.$queryRaw`SELECT id FROM purchases WHERE id = ${transactionId}::uuid FOR UPDATE`;
      } else {
        lockQuery = tx.$queryRaw`SELECT id FROM sales WHERE id = ${transactionId}::uuid FOR UPDATE`;
      }
      const [locked] = await lockQuery;
      if (!locked) throw new NotFoundError(type === 'purchase' ? 'Purchase' : 'Sale', transactionId);

      // Overpayment guard
      const totalAmount  = await getTotalForTransaction(tx, type, transactionId);
      const alreadyPaid  = await getTotalPaid(tx, type, transactionId);
      const remaining    = subtract(totalAmount, alreadyPaid);
      const paymentAmount = new Decimal(data.amount.toString());

      if (isGreaterThan(paymentAmount, remaining)) {
        throw new OverpaymentError(
          paymentAmount.toNumber(),
          remaining.toNumber(),
          transactionId,
        );
      }

      const paymentNumber = await nextCode(prisma, 'payment', 'PAY');
      const paymentType   = type === 'purchase' ? 'PURCHASE_PAYMENT' : 'SALE_RECEIPT';

      return tx.payment.create({
        data: {
          id:            uuidv4(),
          paymentNumber,
          paymentType,
          paymentMethod: data.paymentMethod,
          status:        'COMPLETED',
          ...(type === 'purchase' ? { purchaseId: transactionId } : { saleId: transactionId }),
          amount:        data.amount,
          currency:      data.currency || 'ETB',
          paymentDate:   data.paymentDate,
          dueDate:       data.dueDate || null,
          reference:     data.reference || null,
          notes:         data.notes || null,
          operationId:   data.operationId,
          createdById:   userId,
          deviceId:      data.deviceId || null,
        },
      });
    },
    { isolationLevel: 'Serializable', timeout: 15_000 },
  );
}

// ─── Void payment (creates compensating record, not a delete) ─────────────────

async function voidPayment(paymentId, reason, userId) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new NotFoundError('Payment', paymentId);
  if (payment.status === 'VOIDED') {
    throw new BusinessRuleError('PAYMENT_ALREADY_VOIDED', 'Payment has already been voided');
  }

  // Mark original as voided
  const voided = await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status:      'VOIDED',
      voidedAt:    new Date(),
      voidedById:  userId,
      voidReason:  reason,
      version:     { increment: 1 },
    },
  });

  return voided;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

async function getPaymentsForPurchase(purchaseId) {
  const payments = await prisma.payment.findMany({
    where: { purchaseId },
    orderBy: { paymentDate: 'desc' },
  });
  const total = await getTransactionPaymentSummary('purchase', purchaseId);
  return { payments, summary: total };
}

async function getPaymentsForSale(saleId) {
  const payments = await prisma.payment.findMany({
    where: { saleId },
    orderBy: { paymentDate: 'desc' },
  });
  const total = await getTransactionPaymentSummary('sale', saleId);
  return { payments, summary: total };
}

async function getTransactionPaymentSummary(type, id) {
  const totalAmount = await getTotalForTransaction(prisma, type, id);
  const totalPaid   = await getTotalPaid(prisma, type, id);
  const remaining   = subtract(totalAmount, totalPaid);
  return {
    totalAmount:    totalAmount.toFixed(2),
    totalPaid:      totalPaid.toFixed(2),
    remainingAmount: remaining.toFixed(2),
    isFullyPaid:    remaining.isZero() || remaining.isNegative(),
  };
}

async function listOutstandingPayments(query) {
  const page  = parseInt(query.page  || 1,  10);
  const limit = parseInt(query.limit || 50, 10);
  const { type } = query;

  if (type === 'sale') {
    const sales = await prisma.sale.findMany({
      where: { status: 'CONFIRMED', creditTerms: { not: 'CASH' } },
      select: {
        id: true, saleNumber: true, creditDueDate: true, totalSaleAmount: true,
        agent: { select: { name: true } },
        payments: { where: { status: 'COMPLETED' }, select: { amount: true } },
      },
      orderBy: { creditDueDate: 'asc' },
      skip: (page - 1) * limit, take: limit,
    });
    return sales.map(s => {
      const paid = s.payments.reduce((a, p) => a + parseFloat(p.amount), 0);
      const remaining = parseFloat(s.totalSaleAmount || 0) - paid;
      return { id: s.id, saleNumber: s.saleNumber, agentName: s.agent?.name, creditDueDate: s.creditDueDate, totalAmount: parseFloat(s.totalSaleAmount || 0).toFixed(2), totalPaid: paid.toFixed(2), remainingAmount: remaining.toFixed(2) };
    }).filter(s => parseFloat(s.remainingAmount) > 0);
  }

  // Default: purchase AP
  const purchases = await prisma.purchase.findMany({
    where: { status: 'APPROVED', creditTerms: { not: 'CASH' } },
    select: {
      id: true, purchaseNumber: true, creditDueDate: true, creditTerms: true,
      agent: { select: { name: true } },
      items: { select: { totalPrice: true } },
      payments: { where: { status: 'COMPLETED' }, select: { amount: true } },
    },
    orderBy: { creditDueDate: 'asc' },
    skip: (page - 1) * limit, take: limit,
  });
  return purchases.map(p => {
    const total = p.items.reduce((a, i) => a + parseFloat(i.totalPrice), 0);
    const paid  = p.payments.reduce((a, py) => a + parseFloat(py.amount), 0);
    const remaining = total - paid;
    return { id: p.id, purchaseNumber: p.purchaseNumber, agentName: p.agent?.name, creditTerms: p.creditTerms, creditDueDate: p.creditDueDate, totalAmount: total.toFixed(2), totalPaid: paid.toFixed(2), remainingAmount: remaining.toFixed(2) };
  }).filter(p => parseFloat(p.remainingAmount) > 0);
}

async function listDuePayments() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [purchaseDueRaw, saleDueRaw] = await Promise.all([
    prisma.purchase.findMany({
      where: { status: 'APPROVED', creditTerms: { not: 'CASH' }, creditDueDate: { lte: today } },
      select: { id: true, purchaseNumber: true, creditDueDate: true, agent: { select: { name: true } }, items: { select: { totalPrice: true } }, payments: { where: { status: 'COMPLETED' }, select: { amount: true } } },
      orderBy: { creditDueDate: 'asc' },
    }),
    prisma.sale.findMany({
      where: { status: 'CONFIRMED', creditTerms: { not: 'CASH' }, creditDueDate: { lte: today } },
      select: { id: true, saleNumber: true, creditDueDate: true, totalSaleAmount: true, agent: { select: { name: true } }, payments: { where: { status: 'COMPLETED' }, select: { amount: true } } },
      orderBy: { creditDueDate: 'asc' },
    }),
  ]);

  const purchaseDue = purchaseDueRaw.map(p => {
    const total = p.items.reduce((a, i) => a + parseFloat(i.totalPrice), 0);
    const paid  = p.payments.reduce((a, py) => a + parseFloat(py.amount), 0);
    const remaining = total - paid;
    return { id: p.id, purchaseNumber: p.purchaseNumber, agentName: p.agent?.name, creditDueDate: p.creditDueDate, totalAmount: total.toFixed(2), totalPaid: paid.toFixed(2), remainingAmount: remaining.toFixed(2) };
  }).filter(p => parseFloat(p.remainingAmount) > 0);

  const saleDue = saleDueRaw.map(s => {
    const total = parseFloat(s.totalSaleAmount || 0);
    const paid  = s.payments.reduce((a, p) => a + parseFloat(p.amount), 0);
    const remaining = total - paid;
    return { id: s.id, saleNumber: s.saleNumber, agentName: s.agent?.name, creditDueDate: s.creditDueDate, totalAmount: total.toFixed(2), totalPaid: paid.toFixed(2), remainingAmount: remaining.toFixed(2) };
  }).filter(s => parseFloat(s.remainingAmount) > 0);

  return { purchaseDue, saleDue };
}

module.exports = {
  createPurchasePayment,
  createSalePayment,
  voidPayment,
  getPaymentsForPurchase,
  getPaymentsForSale,
  listOutstandingPayments,
  listDuePayments,
};
