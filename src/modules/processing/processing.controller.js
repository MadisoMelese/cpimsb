'use strict';

const svc = require('./processing.service');

async function createRun(req, res, next) {
  try {
    const run = await svc.createProcessingRun(req.body, req.user.id);
    res.status(201).json({ success: true, data: run });
  } catch (err) { next(err); }
}
async function listRuns(req, res, next) {
  try {
    const result = await svc.listProcessingRuns(req.query);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
}
async function getRun(req, res, next) {
  try {
    const run = await svc.getProcessingRunById(req.params.id);
    res.json({ success: true, data: run });
  } catch (err) { next(err); }
}
async function addInputs(req, res, next) {
  try {
    const inputs = await svc.addInputs(req.params.id, req.body, req.user.id);
    res.json({ success: true, data: inputs });
  } catch (err) { next(err); }
}
async function complete(req, res, next) {
  try {
    const result = await svc.completeProcessing(
      req.params.id,
      { outputs: req.body.outputs },
      req.body.operationId,
      req.user.id,
    );
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}
async function cancel(req, res, next) {
  try {
    const result = await svc.cancelProcessingRun(req.params.id, req.user.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

module.exports = { createRun, listRuns, getRun, addInputs, complete, cancel };
