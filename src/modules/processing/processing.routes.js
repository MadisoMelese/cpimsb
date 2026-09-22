'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('./processing.controller');
const { authenticate, authorize } = require('../auth/auth.middleware');
const { validate } = require('../../common/validation/validate');
const {
  createProcessingRunSchema,
  addProcessingInputSchema,
  addProcessingOutputSchema,
  completeProcessingSchema,
  paginationSchema,
} = require('../../common/validation/schemas');

router.use(authenticate);

// ALL processing write operations are BOSS/ADMIN only
// Storekeeper can only VIEW processing runs
router.post('/',             authorize('BOSS', 'ADMIN'), validate(createProcessingRunSchema),  ctrl.createRun);
router.get('/',              validate(paginationSchema, 'query'),  ctrl.listRuns);
router.get('/:id',                                                  ctrl.getRun);
router.post('/:id/inputs',   authorize('BOSS', 'ADMIN'), validate(addProcessingInputSchema),   ctrl.addInputs);
router.post('/:id/complete', authorize('BOSS', 'ADMIN'), validate(addProcessingOutputSchema.merge(completeProcessingSchema)), ctrl.complete);
router.post('/:id/cancel',   authorize('BOSS', 'ADMIN'),           ctrl.cancel);

module.exports = router;
