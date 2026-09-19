'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('./purchases.controller');
const { authenticate, authorize } = require('../auth/auth.middleware');
const { validate, validateAll } = require('../../common/validation/validate');
const {
  createPurchaseSchema,
  updatePurchaseSchema,
  rejectPurchaseSchema,
  approvePurchaseSchema,
  paginationSchema,
} = require('../../common/validation/schemas');

router.use(authenticate);

// Collection
router.post('/', validate(createPurchaseSchema), ctrl.createPurchase);
router.get('/',  validate(paginationSchema, 'query'), ctrl.listPurchases);

// Single purchase
router.get('/:id',   ctrl.getPurchase);
router.patch('/:id', validate(updatePurchaseSchema), ctrl.updatePurchase);

// Workflow transitions
router.post('/:id/submit',  ctrl.submitPurchase);
router.post('/:id/verify',  authorize('BOSS', 'ADMIN', 'VERIFIER'), ctrl.verifyPurchase);
router.post('/:id/approve', authorize('BOSS', 'ADMIN'),             validate(approvePurchaseSchema), ctrl.approvePurchase);
router.post('/:id/reject',  authorize('BOSS', 'ADMIN'),             validate(rejectPurchaseSchema),  ctrl.rejectPurchase);

module.exports = router;
