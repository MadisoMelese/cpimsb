'use strict';

const express = require('express');
const router  = express.Router();
const authController = require('./auth.controller');
const { validate }   = require('../../common/validation/validate');
const { authenticate } = require('./auth.middleware');
const {
  loginSchema,
  refreshTokenSchema,
} = require('../../common/validation/schemas');

router.post('/login',   validate(loginSchema),        authController.login);
router.post('/refresh', validate(refreshTokenSchema), authController.refresh);
router.post('/logout',  authenticate,                 authController.logout);
router.get('/me',       authenticate,                 authController.me);

module.exports = router;
