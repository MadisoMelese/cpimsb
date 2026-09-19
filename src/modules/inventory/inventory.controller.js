'use strict';

const svc = require('./inventory.service');

async function getOverview(req, res, next) {
  try {
    const data = await svc.getInventoryOverview(req.query.locationId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
async function listBatches(req, res, next) {
  try {
    const result = await svc.listBatches(req.query);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
}
async function getBatch(req, res, next) {
  try {
    const data = await svc.getBatchById(req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
async function listLedger(req, res, next) {
  try {
    const result = await svc.listLedger(req.query);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
}
async function createTransfer(req, res, next) {
  try {
    const result = await svc.createTransfer(req.body, req.user.id);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}
async function createAdjustment(req, res, next) {
  try {
    const result = await svc.createAdjustment(req.body, req.user.id);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

module.exports = { getOverview, listBatches, getBatch, listLedger, createTransfer, createAdjustment };
