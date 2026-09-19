'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('./reports.controller');
const { authenticate, authorize } = require('../auth/auth.middleware');
const { validate }  = require('../../common/validation/validate');
const { dateRangeSchema } = require('../../common/validation/schemas');

router.use(authenticate);

// Collection reports
router.get('/daily-purchases',    authorize('BOSS', 'ADMIN', 'STOREKEEPER'), validate(dateRangeSchema, 'query'), ctrl.dailyPurchases);
router.get('/reconciliation/:id', authorize('BOSS', 'ADMIN'),                                                    ctrl.reconciliation);
router.get('/processing-loss',    authorize('BOSS', 'ADMIN', 'STOREKEEPER'), validate(dateRangeSchema, 'query'), ctrl.processingLoss);
router.get('/payments',           authorize('BOSS', 'ADMIN'),                validate(dateRangeSchema, 'query'), ctrl.payments);
router.get('/credit',             authorize('BOSS', 'ADMIN'),                                                    ctrl.credit);

// Agent reports — overview list, then individual printable drill-down
router.get('/agents',             authorize('BOSS', 'ADMIN'),                validate(dateRangeSchema, 'query'), ctrl.agentPerformance);
router.get('/agents/:id',         authorize('BOSS', 'ADMIN'),                validate(dateRangeSchema, 'query'), ctrl.individualAgent);

module.exports = router;
