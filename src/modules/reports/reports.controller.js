'use strict';

const svc = require('./reports.service');

async function dailyPurchases(req, res, next) {
  try { res.json({ success: true, data: await svc.dailyPurchaseReport(req.query) }); }
  catch (err) { next(err); }
}
async function reconciliation(req, res, next) {
  try { res.json({ success: true, data: await svc.reconciliationReport(req.params.id) }); }
  catch (err) { next(err); }
}
async function agentPerformance(req, res, next) {
  try { res.json({ success: true, data: await svc.agentPerformanceReport(req.query) }); }
  catch (err) { next(err); }
}
async function individualAgent(req, res, next) {
  try { res.json({ success: true, data: await svc.individualAgentReport(req.params.id, req.query) }); }
  catch (err) { next(err); }
}
async function payments(req, res, next) {
  try { res.json({ success: true, data: await svc.paymentReport(req.query) }); }
  catch (err) { next(err); }
}
async function credit(req, res, next) {
  try { res.json({ success: true, data: await svc.creditReport() }); }
  catch (err) { next(err); }
}
async function processingLoss(req, res, next) {
  try { res.json({ success: true, data: await svc.processingLossReport(req.query) }); }
  catch (err) { next(err); }
}

module.exports = { dailyPurchases, reconciliation, agentPerformance, individualAgent, payments, credit, processingLoss };
