'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('./sales.controller');
const { authenticate, authorize } = require('../auth/auth.middleware');
const { validate } = require('../../common/validation/validate');
const { createSaleSchema, confirmSaleSchema, paginationSchema } = require('../../common/validation/schemas');

router.use(authenticate);

router.post('/',           validate(createSaleSchema),           ctrl.createSale);
router.get('/',            validate(paginationSchema, 'query'),  ctrl.listSales);
router.get('/:id',                                                ctrl.getSale);
router.post('/:id/confirm', validate(confirmSaleSchema),         ctrl.confirmSale);
router.post('/:id/cancel',  authorize('BOSS', 'ADMIN'),          ctrl.cancelSale);

module.exports = router;
