'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('./coffeeTypes.controller');
const { authenticate, authorize } = require('../auth/auth.middleware');
const { validate } = require('../../common/validation/validate');
const { createCoffeeTypeSchema } = require('../../common/validation/schemas');

router.use(authenticate);
router.post('/',    authorize('BOSS', 'ADMIN'), validate(createCoffeeTypeSchema), ctrl.create);
router.get('/',                                                                     ctrl.list);
router.get('/:id',                                                                  ctrl.get);
router.patch('/:id', authorize('BOSS', 'ADMIN'), validate(createCoffeeTypeSchema.partial()), ctrl.update);

module.exports = router;
