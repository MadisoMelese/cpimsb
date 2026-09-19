'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate, authorize } = require('../auth/auth.middleware');
const auditService = require('./audit.service');

router.use(authenticate);

router.get('/', authorize('BOSS', 'ADMIN'), async (req, res, next) => {
  try {
    const result = await auditService.listLogs(req.query);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

module.exports = router;
