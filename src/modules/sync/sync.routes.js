'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('./sync.controller');
const { authenticate, authorize } = require('../auth/auth.middleware');
const { validate } = require('../../common/validation/validate');
const { syncPushSchema, syncPullSchema, resolveConflictSchema } = require('../../common/validation/schemas');

router.use(authenticate);

router.post('/push',                validate(syncPushSchema),           ctrl.push);
router.get('/pull',                 validate(syncPullSchema, 'query'),  ctrl.pull);
router.get('/conflicts',                                                 ctrl.listConflicts);
router.get('/conflicts/:id',                                             ctrl.getConflict);
router.post('/conflicts/:id/resolve',
  authorize('BOSS', 'ADMIN'),
  validate(resolveConflictSchema),
  ctrl.resolveConflict,
);

module.exports = router;
