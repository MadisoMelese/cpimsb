'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('./users.controller');
const { authenticate, authorize, authorizeOwnerOrAdmin } = require('../auth/auth.middleware');
const { validate } = require('../../common/validation/validate');
const { createUserSchema, updateUserSchema, paginationSchema } = require('../../common/validation/schemas');
const { z } = require('zod');

// All user routes require authentication
router.use(authenticate);

router.post('/',    authorize('BOSS', 'ADMIN'), validate(createUserSchema),           ctrl.createUser);
router.get('/',     authorize('BOSS', 'ADMIN'), validate(paginationSchema, 'query'),  ctrl.listUsers);
router.get('/:id',  authorizeOwnerOrAdmin,                                             ctrl.getUser);
router.patch('/:id', authorize('BOSS', 'ADMIN'), validate(updateUserSchema),          ctrl.updateUser);
router.post('/:id/change-password',
  authorizeOwnerOrAdmin,
  validate(z.object({ password: z.string().min(8).max(255) })),
  ctrl.changePassword,
);

module.exports = router;
