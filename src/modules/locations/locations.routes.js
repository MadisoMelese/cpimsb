'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('./locations.controller');
const { authenticate, authorize } = require('../auth/auth.middleware');
const { validate }   = require('../../common/validation/validate');
const { createLocationSchema } = require('../../common/validation/schemas');

router.use(authenticate);
router.post('/',    authorize('BOSS', 'ADMIN'), validate(createLocationSchema), ctrl.create);
router.get('/',                                                                   ctrl.list);
router.get('/:id',                                                                ctrl.get);
router.patch('/:id', authorize('BOSS', 'ADMIN'), validate(createLocationSchema.partial()), ctrl.update);

module.exports = router;
