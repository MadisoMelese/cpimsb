'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('./payments.controller');
const { authenticate, authorize } = require('../auth/auth.middleware');
const { validate } = require('../../common/validation/validate');
const { createPaymentSchema, voidPaymentSchema, paginationSchema } = require('../../common/validation/schemas');

router.use(authenticate);

// Purchase payments (AP)
router.post('/purchases/:id/payments',  validate(createPaymentSchema),    ctrl.createPurchasePayment);
router.get('/purchases/:id/payments',                                      ctrl.getPurchasePayments);

// Sale receipts (AR)
router.post('/sales/:id/payments',      validate(createPaymentSchema),    ctrl.createSalePayment);
router.get('/sales/:id/payments',                                          ctrl.getSalePayments);

// Void
router.post('/:id/void',    authorize('BOSS', 'ADMIN'), validate(voidPaymentSchema), ctrl.voidPayment);

// Reports
router.get('/outstanding',  validate(paginationSchema, 'query'), ctrl.listOutstanding);
router.get('/due',                                                ctrl.listDue);

module.exports = router;
