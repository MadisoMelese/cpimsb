'use strict';

const svc = require('./purchases.service');

async function createPurchase(req, res, next) {
  try {
    const data = { ...req.body };
    // STOREKEEPER cannot set credit terms — always forced to CASH
    if (req.user.role === 'STOREKEEPER') {
      data.creditTerms    = 'CASH';
      data.creditDueDays  = undefined;
    }
    const purchase = await svc.createPurchase(data, req.user.id);
    res.status(201).json({ success: true, data: purchase });
  } catch (err) { next(err); }
}
async function listPurchases(req, res, next) {
  try {
    const result = await svc.listPurchases(req.query);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
}
async function getPurchase(req, res, next) {
  try {
    const purchase = await svc.getPurchaseById(req.params.id);
    res.json({ success: true, data: purchase });
  } catch (err) { next(err); }
}
async function updatePurchase(req, res, next) {
  try {
    const purchase = await svc.updatePurchase(req.params.id, req.body, req.user.id);
    res.json({ success: true, data: purchase });
  } catch (err) { next(err); }
}
async function submitPurchase(req, res, next) {
  try {
    const purchase = await svc.submitPurchase(req.params.id, req.user.id);
    res.json({ success: true, data: purchase });
  } catch (err) { next(err); }
}
async function verifyPurchase(req, res, next) {
  try {
    const purchase = await svc.verifyPurchase(req.params.id, req.user.id);
    res.json({ success: true, data: purchase });
  } catch (err) { next(err); }
}
async function approvePurchase(req, res, next) {
  try {
    const result = await svc.approvePurchase(req.params.id, req.body.operationId, req.user.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}
async function rejectPurchase(req, res, next) {
  try {
    const purchase = await svc.rejectPurchase(req.params.id, req.body.reason, req.user.id);
    res.json({ success: true, data: purchase });
  } catch (err) { next(err); }
}

async function setGradePayment(req, res, next) {
  try {
    const result = await svc.setGradePayment(req.params.id, req.body);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

module.exports = {
  createPurchase, listPurchases, getPurchase, updatePurchase,
  submitPurchase, verifyPurchase, approvePurchase, rejectPurchase,
  setGradePayment,
};
