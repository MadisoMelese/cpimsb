'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('./payments.controller');
const { authenticate, authorize } = require('../auth/auth.middleware');
const { validate } = require('../../common/validation/validate');
const { createPaymentSchema, voidPaymentSchema, paginationSchema } = require('../../common/validation/schemas');

router.use(authenticate);

// ALL payment operations are BOSS/ADMIN only
// Storekeeper must not see or record payment information

// Purchase payments (AP)
router.post('/purchases/:id/payments', authorize('BOSS', 'ADMIN'), validate(createPaymentSchema), ctrl.createPurchasePayment);
router.get('/purchases/:id/payments',  authorize('BOSS', 'ADMIN'),                                ctrl.getPurchasePayments);

// Sale receipts (AR)
router.post('/sales/:id/payments',     authorize('BOSS', 'ADMIN'), validate(createPaymentSchema), ctrl.createSalePayment);
router.get('/sales/:id/payments',      authorize('BOSS', 'ADMIN'),                                ctrl.getSalePayments);

// Void
router.post('/:id/void',               authorize('BOSS', 'ADMIN'), validate(voidPaymentSchema),   ctrl.voidPayment);

// Reports
router.get('/outstanding',             authorize('BOSS', 'ADMIN'), validate(paginationSchema, 'query'), ctrl.listOutstanding);
router.get('/due',                     authorize('BOSS', 'ADMIN'),                                ctrl.listDue);

module.exports = router;
