'use strict';

const svc = require('./sync.service');

async function push(req, res, next) {
  try {
    const deviceId = req.body.operations[0]?.deviceId || req.user.id;
    const results  = await svc.processPush(req.body.operations, deviceId);
    res.json({ success: true, data: results });
  } catch (err) { next(err); }
}
async function pull(req, res, next) {
  try {
    const data = await svc.processPull(req.query);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
async function listConflicts(req, res, next) {
  try {
    const data = await svc.listConflicts(req.query);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
async function getConflict(req, res, next) {
  try {
    const data = await svc.getConflict(req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
async function resolveConflict(req, res, next) {
  try {
    const data = await svc.resolveConflict(req.params.id, req.body, req.user.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

module.exports = { push, pull, listConflicts, getConflict, resolveConflict };
