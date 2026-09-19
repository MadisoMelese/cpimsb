'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('./advances.controller');
const { authenticate, authorize } = require('../auth/auth.middleware');
const { validate } = require('../../common/validation/validate');
const { z } = require('zod');

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform(s => new Date(s));

const giveAdvanceSchema = z.object({
  agentId:       z.string().uuid(),
  amount:        z.number().positive(),
  advanceDate:   dateField,
  paymentMethod: z.enum(['CASH','BANK_TRANSFER','MOBILE_MONEY','CHEQUE','OTHER']),
  reference:     z.string().max(255).optional(),
  notes:         z.string().max(2000).optional(),
  operationId:   z.string().uuid(),
});

const addExpenseSchema = z.object({
  category:    z.enum(['COFFEE_PURCHASE','TRANSPORT','BAGS_PACKAGING','LOADING_LABOUR','WEIGHING_FEES','AGENT_COMMISSION','OTHER']),
  amount:      z.number().positive(),
  description: z.string().min(1).max(1000),
  expenseDate: dateField,
  purchaseId:  z.string().uuid().optional(),
  receiptRef:  z.string().max(255).optional(),
});

const recordReturnSchema = z.object({
  returnedAmount: z.number().nonnegative(),
  returnedDate:   dateField,
  returnedMethod: z.enum(['CASH','BANK_TRANSFER','MOBILE_MONEY','CHEQUE','OTHER']),
  returnReference: z.string().max(255).optional(),
});

router.use(authenticate);

// Overview of all agents' accounts
router.get('/overview',              ctrl.allAgentsSummary);

// Per-agent account
router.get('/agents/:agentId',       ctrl.agentSummary);

// Advance CRUD
router.post('/',                     authorize('BOSS', 'ADMIN'), validate(giveAdvanceSchema), ctrl.giveAdvance);
router.get('/',                      ctrl.listAdvances);
router.get('/:id',                   ctrl.getAdvance);
router.post('/:id/submit',           ctrl.submitAdvance);
router.post('/:id/approve',          authorize('BOSS', 'ADMIN'), ctrl.approveAdvance);
router.post('/:id/void',             authorize('BOSS', 'ADMIN'), validate(z.object({ reason: z.string().min(1) })), ctrl.voidAdvance);

// Expenses
router.post('/:id/expenses',         validate(addExpenseSchema), ctrl.addExpense);
router.delete('/:id/expenses/:expenseId', authorize('BOSS', 'ADMIN'), ctrl.deleteExpense);

// Return
router.post('/:id/return',           validate(recordReturnSchema), ctrl.recordReturn);

module.exports = router;
