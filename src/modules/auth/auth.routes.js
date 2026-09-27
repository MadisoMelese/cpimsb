'use strict';

const express = require('express');
const router  = express.Router();
const authController = require('./auth.controller');
const { validate }   = require('../../common/validation/validate');
const { authenticate } = require('./auth.middleware');
const { z } = require('zod');
const {
  loginSchema,
  refreshTokenSchema,
} = require('../../common/validation/schemas');

router.post('/login',   validate(loginSchema),        authController.login);
router.post('/refresh', validate(refreshTokenSchema), authController.refresh);
router.post('/logout',  authenticate,                 authController.logout);
router.get('/me',       authenticate,                 authController.me);

// Public — no auth required
router.post('/forgot-password',
  validate(z.object({ email: z.string().email() })),
  authController.forgotPassword,
);
router.post('/reset-password',
  validate(z.object({ token: z.string().min(1), password: z.string().min(8).max(255) })),
  authController.resetPassword,
);

module.exports = router;
