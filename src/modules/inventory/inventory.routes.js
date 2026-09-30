'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('./inventory.controller');
const { authenticate, authorize } = require('../auth/auth.middleware');
const { validate }   = require('../../common/validation/validate');
const { z } = require('zod');
const {
  paginationSchema,
  stockAdjustmentSchema,
  transferSchema,
} = require('../../common/validation/schemas');

router.use(authenticate);

router.get('/',                                                                          ctrl.getOverview);
router.get('/batches',           validate(paginationSchema, 'query'),                   ctrl.listBatches);
router.get('/batches/:id',                                                               ctrl.getBatch);
router.patch('/batches/:id/grade',
  authorize('BOSS', 'ADMIN'),
  validate(z.object({ grade: z.string().max(20).nullable().optional() })),
  ctrl.gradeBatch,
);
router.patch('/batches/:id/certificate',
  authorize('BOSS', 'ADMIN'),
  validate(z.object({ imageUrl: z.string().min(1).max(1000) })),
  ctrl.uploadCertificate,
);
router.get('/ledger',            validate(paginationSchema, 'query'),                   ctrl.listLedger);
router.post('/transfers',        validate(transferSchema),                              ctrl.createTransfer);
router.post('/adjustments',      authorize('BOSS', 'ADMIN'), validate(stockAdjustmentSchema), ctrl.createAdjustment);

module.exports = router;
