'use strict';

const svc = require('./payments.service');

async function createPurchasePayment(req, res, next) {
  try {
    const result = await svc.createPurchasePayment(req.params.id, req.body, req.user.id);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}
async function createSalePayment(req, res, next) {
  try {
    const result = await svc.createSalePayment(req.params.id, req.body, req.user.id);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}
async function getPurchasePayments(req, res, next) {
  try {
    const result = await svc.getPaymentsForPurchase(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}
async function getSalePayments(req, res, next) {
  try {
    const result = await svc.getPaymentsForSale(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}
async function voidPayment(req, res, next) {
  try {
    const result = await svc.voidPayment(req.params.id, req.body.reason, req.user.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}
async function listOutstanding(req, res, next) {
  try {
    const result = await svc.listOutstandingPayments(req.query);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}
async function listDue(req, res, next) {
  try {
    const result = await svc.listDuePayments();
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

module.exports = {
  createPurchasePayment, createSalePayment, getPurchasePayments, getSalePayments,
  voidPayment, listOutstanding, listDue,
};
