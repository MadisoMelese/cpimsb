'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('./agents.controller');
const { authenticate, authorize } = require('../auth/auth.middleware');
const { validate } = require('../../common/validation/validate');
const { createAgentSchema, updateAgentSchema, paginationSchema } = require('../../common/validation/schemas');
const { z } = require('zod');

router.use(authenticate);

// Collection
router.post('/',    authorize('BOSS', 'ADMIN'), validate(createAgentSchema),          ctrl.createAgent);
router.get('/',                                  validate(paginationSchema, 'query'),  ctrl.listAgents);

// Single agent
router.get('/:id',         ctrl.getAgent);
router.get('/:id/stats',   ctrl.getAgentWithStats);

// Mutations — Boss/Admin only
router.patch('/:id',       authorize('BOSS', 'ADMIN'), validate(updateAgentSchema),   ctrl.updateAgent);
router.patch('/:id/photo', authorize('BOSS', 'ADMIN'), validate(z.object({ photoUrl: z.string().max(500).nullable() })), ctrl.updatePhoto);
router.post('/:id/activate',   authorize('BOSS', 'ADMIN'), ctrl.activateAgent);
router.post('/:id/deactivate', authorize('BOSS', 'ADMIN'), ctrl.deactivateAgent);
router.delete('/:id',          authorize('BOSS', 'ADMIN'), ctrl.deleteAgent);

module.exports = router;
