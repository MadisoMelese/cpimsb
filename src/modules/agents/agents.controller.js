'use strict';

const svc = require('./agents.service');

async function createAgent(req, res, next) {
  try { res.status(201).json({ success: true, data: await svc.createAgent(req.body) }); }
  catch (err) { next(err); }
}

async function listAgents(req, res, next) {
  try { res.json({ success: true, ...await svc.listAgents(req.query) }); }
  catch (err) { next(err); }
}

async function getAgent(req, res, next) {
  try { res.json({ success: true, data: await svc.getAgentById(req.params.id) }); }
  catch (err) { next(err); }
}

async function getAgentWithStats(req, res, next) {
  try { res.json({ success: true, data: await svc.getAgentWithStats(req.params.id) }); }
  catch (err) { next(err); }
}

async function updateAgent(req, res, next) {
  try { res.json({ success: true, data: await svc.updateAgent(req.params.id, req.body) }); }
  catch (err) { next(err); }
}

async function updatePhoto(req, res, next) {
  try {
    const { photoUrl } = req.body;
    res.json({ success: true, data: await svc.updatePhoto(req.params.id, photoUrl) });
  } catch (err) { next(err); }
}

async function activateAgent(req, res, next) {
  try { res.json({ success: true, data: await svc.activateAgent(req.params.id) }); }
  catch (err) { next(err); }
}

async function deactivateAgent(req, res, next) {
  try { res.json({ success: true, data: await svc.deactivateAgent(req.params.id) }); }
  catch (err) { next(err); }
}

async function deleteAgent(req, res, next) {
  try {
    await svc.deleteAgent(req.params.id);
    res.json({ success: true, message: 'Agent deleted permanently' });
  } catch (err) { next(err); }
}

module.exports = {
  createAgent, listAgents, getAgent, getAgentWithStats,
  updateAgent, updatePhoto, activateAgent, deactivateAgent, deleteAgent,
};
