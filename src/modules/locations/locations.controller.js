'use strict';

const svc = require('./locations.service');

async function create(req, res, next) {
  try { res.status(201).json({ success: true, data: await svc.createLocation(req.body) }); }
  catch (err) { next(err); }
}
async function list(req, res, next) {
  try { res.json({ success: true, data: await svc.listLocations() }); }
  catch (err) { next(err); }
}
async function get(req, res, next) {
  try { res.json({ success: true, data: await svc.getLocationById(req.params.id) }); }
  catch (err) { next(err); }
}
async function update(req, res, next) {
  try { res.json({ success: true, data: await svc.updateLocation(req.params.id, req.body) }); }
  catch (err) { next(err); }
}

module.exports = { create, list, get, update };
