'use strict';

const svc = require('./reconciliation.service');

async function createSession(req, res, next) {
  try { res.status(201).json({ success: true, data: await svc.createSession(req.body, req.user.id) }); }
  catch (err) { next(err); }
}
async function listSessions(req, res, next) {
  try { res.json({ success: true, data: await svc.listSessions(req.query) }); }
  catch (err) { next(err); }
}
async function getSession(req, res, next) {
  try { res.json({ success: true, data: await svc.getSessionById(req.params.id) }); }
  catch (err) { next(err); }
}
async function recordVerifications(req, res, next) {
  try { res.json({ success: true, data: await svc.recordVerifications(req.params.id, req.body, req.user.id) }); }
  catch (err) { next(err); }
}
async function createAdjustment(req, res, next) {
  try { res.status(201).json({ success: true, data: await svc.createAdjustment(req.params.id, req.body, req.user.id) }); }
  catch (err) { next(err); }
}
async function closeSession(req, res, next) {
  try { res.json({ success: true, data: await svc.closeSession(req.params.id, req.body, req.user.id) }); }
  catch (err) { next(err); }
}

module.exports = { createSession, listSessions, getSession, recordVerifications, createAdjustment, closeSession };
