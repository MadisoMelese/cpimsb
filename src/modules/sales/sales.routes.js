'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('./sales.controller');
const { authenticate, authorize } = require('../auth/auth.middleware');
const { validate } = require('../../common/validation/validate');
const { createSaleSchema, confirmSaleSchema, paginationSchema } = require('../../common/validation/schemas');

router.use(authenticate);

// Sales are BOSS/ADMIN only — Storekeeper only does receiving (purchases)
router.post('/',            authorize('BOSS', 'ADMIN'), validate(createSaleSchema),          ctrl.createSale);
router.get('/',             authorize('BOSS', 'ADMIN'), validate(paginationSchema, 'query'), ctrl.listSales);
router.get('/:id',          authorize('BOSS', 'ADMIN'),                                      ctrl.getSale);
router.post('/:id/confirm', authorize('BOSS', 'ADMIN'), validate(confirmSaleSchema),         ctrl.confirmSale);
router.post('/:id/cancel',  authorize('BOSS', 'ADMIN'),                                      ctrl.cancelSale);

module.exports = router;
