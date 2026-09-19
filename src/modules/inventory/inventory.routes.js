'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('./inventory.controller');
const { authenticate, authorize } = require('../auth/auth.middleware');
const { validate }   = require('../../common/validation/validate');
const {
  paginationSchema,
  stockAdjustmentSchema,
  transferSchema,
} = require('../../common/validation/schemas');

router.use(authenticate);

router.get('/',                                                                     ctrl.getOverview);
router.get('/batches',          validate(paginationSchema, 'query'),                ctrl.listBatches);
router.get('/batches/:id',                                                          ctrl.getBatch);
router.get('/ledger',           validate(paginationSchema, 'query'),                ctrl.listLedger);
router.post('/transfers',       validate(transferSchema),                           ctrl.createTransfer);
router.post('/adjustments',     authorize('BOSS', 'ADMIN'), validate(stockAdjustmentSchema), ctrl.createAdjustment);

module.exports = router;
