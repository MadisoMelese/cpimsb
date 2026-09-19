'use strict';

const svc = require('./sales.service');

async function createSale(req, res, next) {
  try {
    const sale = await svc.createSale(req.body, req.user.id);
    res.status(201).json({ success: true, data: sale });
  } catch (err) { next(err); }
}
async function listSales(req, res, next) {
  try {
    const result = await svc.listSales(req.query);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
}
async function getSale(req, res, next) {
  try {
    const sale = await svc.getSaleById(req.params.id);
    res.json({ success: true, data: sale });
  } catch (err) { next(err); }
}
async function confirmSale(req, res, next) {
  try {
    const result = await svc.confirmSale(req.params.id, req.body.operationId, req.user.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}
async function cancelSale(req, res, next) {
  try {
    const result = await svc.cancelSale(req.params.id, req.user.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

module.exports = { createSale, listSales, getSale, confirmSale, cancelSale };
