'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('./reconciliation.controller');
const { authenticate, authorize } = require('../auth/auth.middleware');
const { validate } = require('../../common/validation/validate');
const {
  createReconciliationSessionSchema,
  reconciliationVerificationSchema,
  reconciliationAdjustmentSchema,
  closeReconciliationSchema,
} = require('../../common/validation/schemas');

router.use(authenticate);

router.post('/sessions',          authorize('BOSS', 'ADMIN'), validate(createReconciliationSessionSchema), ctrl.createSession);
router.get('/sessions',                                                                                       ctrl.listSessions);
router.get('/sessions/:id',                                                                                   ctrl.getSession);
router.post('/sessions/:id/verify',                            validate(reconciliationVerificationSchema),    ctrl.recordVerifications);
router.post('/sessions/:id/adjustments', authorize('BOSS', 'ADMIN'), validate(reconciliationAdjustmentSchema), ctrl.createAdjustment);
router.post('/sessions/:id/close', authorize('BOSS', 'ADMIN'), validate(closeReconciliationSchema),           ctrl.closeSession);

module.exports = router;
