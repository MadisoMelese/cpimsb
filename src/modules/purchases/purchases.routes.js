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

// Admin-only: set grade and payment terms during reconciliation review
router.patch('/:id/grade-payment', authorize('BOSS', 'ADMIN'),
  validate(require('zod').z.object({
    creditTerms:   require('zod').z.enum(['CASH','NET_7','NET_14','NET_30','NET_60','CUSTOM']).optional(),
    creditDueDays: require('zod').z.number().int().positive().optional(),
    creditDueDate: require('zod').z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes:         require('zod').z.string().max(2000).optional(),
  })),
  ctrl.setGradePayment,
);

module.exports = router;
