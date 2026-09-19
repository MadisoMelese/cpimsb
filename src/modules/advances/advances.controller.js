'use strict';

const svc = require('./advances.service');

async function giveAdvance(req, res, next) {
  try { res.status(201).json({ success: true, data: await svc.giveAdvance(req.body, req.user.id) }); }
  catch (err) { next(err); }
}
async function listAdvances(req, res, next) {
  try { res.json({ success: true, ...await svc.listAdvances(req.query) }); }
  catch (err) { next(err); }
}
async function getAdvance(req, res, next) {
  try { res.json({ success: true, data: await svc.getAdvanceById(req.params.id) }); }
  catch (err) { next(err); }
}
async function addExpense(req, res, next) {
  try { res.status(201).json({ success: true, data: await svc.addExpense(req.params.id, req.body) }); }
  catch (err) { next(err); }
}
async function recordReturn(req, res, next) {
  try { res.json({ success: true, data: await svc.recordReturn(req.params.id, req.body) }); }
  catch (err) { next(err); }
}
async function submitAdvance(req, res, next) {
  try { res.json({ success: true, data: await svc.submitAdvance(req.params.id) }); }
  catch (err) { next(err); }
}
async function approveAdvance(req, res, next) {
  try { res.json({ success: true, data: await svc.approveAdvance(req.params.id, req.user.id) }); }
  catch (err) { next(err); }
}
async function voidAdvance(req, res, next) {
  try { res.json({ success: true, data: await svc.voidAdvance(req.params.id, req.body.reason, req.user.id) }); }
  catch (err) { next(err); }
}
async function deleteExpense(req, res, next) {
  try { res.json({ success: true, message: 'Expense deleted', data: await svc.deleteExpense(req.params.expenseId) }); }
  catch (err) { next(err); }
}
async function agentSummary(req, res, next) {
  try { res.json({ success: true, data: await svc.getAgentAccountSummary(req.params.agentId, req.query) }); }
  catch (err) { next(err); }
}
async function allAgentsSummary(req, res, next) {
  try { res.json({ success: true, data: await svc.getAllAgentsAccountOverview(req.query) }); }
  catch (err) { next(err); }
}

module.exports = {
  giveAdvance, listAdvances, getAdvance,
  addExpense, recordReturn,
  submitAdvance, approveAdvance, voidAdvance,
  deleteExpense,
  agentSummary, allAgentsSummary,
};
