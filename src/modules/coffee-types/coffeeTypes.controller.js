'use strict';

const svc = require('./coffeeTypes.service');

async function create(req, res, next) {
  try { res.status(201).json({ success: true, data: await svc.createCoffeeType(req.body) }); }
  catch (err) { next(err); }
}
async function list(req, res, next) {
  try { res.json({ success: true, data: await svc.listCoffeeTypes(req.query) }); }
  catch (err) { next(err); }
}
async function get(req, res, next) {
  try { res.json({ success: true, data: await svc.getCoffeeTypeById(req.params.id) }); }
  catch (err) { next(err); }
}
async function update(req, res, next) {
  try { res.json({ success: true, data: await svc.updateCoffeeType(req.params.id, req.body) }); }
  catch (err) { next(err); }
}

module.exports = { create, list, get, update };
