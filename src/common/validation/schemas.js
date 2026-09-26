'use strict';

const { z } = require('zod');

// ─── Reusable primitives ────────────────────────────────────────────────────

const uuidSchema = z.string().uuid('Must be a valid UUID');

const kgSchema = z
  .number({ invalid_type_error: 'KG must be a number' })
  .positive('KG must be positive')
  .multipleOf(0.001, 'KG precision max 3 decimal places');

const moneySchema = z
  .number({ invalid_type_error: 'Amount must be a number' })
  .nonnegative('Amount must be non-negative')
  .multipleOf(0.01, 'Money precision max 2 decimal places');

const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .transform((s) => new Date(s));

const paginationSchema = z.object({
  page:       z.coerce.number().int().positive().default(1),
  limit:      z.coerce.number().int().min(1).max(200).default(50),
  // Common filter/search params — passed through to service layer
  search:     z.string().max(255).optional(),
  status:     z.string().max(50).optional(),
  agentId:    z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  startDate:  z.string().optional(),
  endDate:    z.string().optional(),
  isSupplier: z.string().optional(),
  isCustomer: z.string().optional(),
  includeInactive: z.string().optional(),
  role:       z.string().optional(),
  isActive:   z.string().optional(),
  coffeeTypeId: z.string().uuid().optional(),
  purchaseId: z.string().uuid().optional(),
  movementType: z.string().optional(),
  batchId:    z.string().uuid().optional(),
  deviceId:   z.string().optional(),
});

// ─── Auth ───────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email:    z.string().email('Must be a valid email'),
  password: z.string().min(1).max(255),
  deviceId: z.string().max(255).optional(),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

// ─── Users ──────────────────────────────────────────────────────────────────

const createUserSchema = z.object({
  username: z.string().min(2).max(100),
  email: z.string().email().max(255),
  password: z.string().min(8).max(255),
  role: z.enum(['BOSS', 'ADMIN', 'STOREKEEPER', 'VERIFIER']),
  fullName: z.string().min(1).max(255),
});

const updateUserSchema = z.object({
  email: z.string().email().max(255).optional(),
  fullName: z.string().min(1).max(255).optional(),
  role: z.enum(['BOSS', 'ADMIN', 'STOREKEEPER', 'VERIFIER']).optional(),
  isActive: z.boolean().optional(),
});

// ─── Agents ─────────────────────────────────────────────────────────────────

const createAgentSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  phone: z.string().max(50).optional(),
  email: z.string().email().max(255).optional(),
  address: z.string().max(1000).optional(),
  isSupplier: z.boolean().default(true),
  isCustomer: z.boolean().default(false),
  notes: z.string().max(2000).optional(),
});

const updateAgentSchema = createAgentSchema.partial().omit({ code: true });

// ─── Locations ──────────────────────────────────────────────────────────────

const createLocationSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
});

// ─── Coffee Types ────────────────────────────────────────────────────────────

const createCoffeeTypeSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  grade: z.string().max(100).optional(),
  state: z.enum(['WET', 'DRY', 'HULLED', 'SORTED', 'GRADED']),
  description: z.string().max(1000).optional(),
});

// ─── Purchases ──────────────────────────────────────────────────────────────

const purchaseItemSchema = z.object({
  coffeeTypeId: uuidSchema,
  quantityKg: kgSchema,
  unitPriceKg: moneySchema,
  moistureContent: z.number().min(0).max(100).optional(),
  notes: z.string().max(1000).optional(),
});

const createPurchaseSchema = z.object({
  agentId: uuidSchema,
  locationId: uuidSchema,
  purchaseDate: dateStringSchema,
  creditTerms: z.enum(['CASH', 'NET_7', 'NET_14', 'NET_30', 'NET_60', 'CUSTOM']).default('CASH'),
  creditDueDays: z.number().int().positive().optional(),
  currency: z.string().length(3).default('KES'),
  notes: z.string().max(2000).optional(),
  items: z.array(purchaseItemSchema).min(1, 'At least one purchase item is required'),
  deviceId: z.string().max(255).optional(),
  operationId: uuidSchema.optional(),
});

const updatePurchaseSchema = z.object({
  agentId: uuidSchema.optional(),
  locationId: uuidSchema.optional(),
  purchaseDate: dateStringSchema.optional(),
  creditTerms: z.enum(['CASH', 'NET_7', 'NET_14', 'NET_30', 'NET_60', 'CUSTOM']).optional(),
  creditDueDays: z.number().int().positive().optional(),
  notes: z.string().max(2000).optional(),
});

const rejectPurchaseSchema = z.object({
  reason: z.string().min(1).max(2000),
});

const approvePurchaseSchema = z.object({
  operationId: uuidSchema, // Required for idempotency
});

// ─── Inventory ───────────────────────────────────────────────────────────────

const stockAdjustmentSchema = z.object({
  batchId: uuidSchema,
  direction: z.enum(['INCREASE', 'DECREASE']),
  quantityKg: kgSchema,
  reason: z.string().min(1).max(2000),
  reconciliationSessionId: uuidSchema.optional(),
  operationId: uuidSchema,
});

const transferSchema = z.object({
  fromLocationId: uuidSchema,
  toLocationId: uuidSchema,
  transferDate: dateStringSchema,
  notes: z.string().max(2000).optional(),
  operationId: uuidSchema,
  lines: z
    .array(
      z.object({
        fromBatchId: uuidSchema,
        quantityKg: kgSchema,
      }),
    )
    .min(1),
});

// ─── Processing ──────────────────────────────────────────────────────────────

const createProcessingRunSchema = z.object({
  locationId: uuidSchema.optional(),
  notes: z.string().max(2000).optional(),
  processingCost: moneySchema.optional(),
  processingCostNotes: z.string().max(1000).optional(),
  deviceId: z.string().max(255).optional(),
  operationId: uuidSchema.optional(),
});

const addProcessingInputSchema = z.object({
  inputs: z
    .array(
      z.object({
        batchId: uuidSchema,
        quantityKg: kgSchema,
      }),
    )
    .min(1),
});

const addProcessingOutputSchema = z.object({
  outputs: z
    .array(
      z.object({
        coffeeTypeId: uuidSchema,
        locationId: uuidSchema,
        quantityKg: kgSchema,
        notes: z.string().max(1000).optional(),
      }),
    )
    .min(1),
});

const completeProcessingSchema = z.object({
  operationId: uuidSchema,
});

// ─── Sales ───────────────────────────────────────────────────────────────────

const saleItemSchema = z.object({
  batchId: uuidSchema,
  quantityKg: kgSchema,
  unitSalePrice: moneySchema,
  notes: z.string().max(1000).optional(),
});

const createSaleSchema = z.object({
  agentId: uuidSchema,
  locationId: uuidSchema.optional(),
  saleDate: dateStringSchema,
  creditTerms: z.enum(['CASH', 'NET_7', 'NET_14', 'NET_30', 'NET_60', 'CUSTOM']).default('CASH'),
  creditDueDays: z.number().int().positive().optional(),
  currency: z.string().length(3).default('KES'),
  notes: z.string().max(2000).optional(),
  items: z.array(saleItemSchema).min(1),
  deviceId: z.string().max(255).optional(),
  operationId: uuidSchema.optional(),
});

const confirmSaleSchema = z.object({
  operationId: uuidSchema,
});

// ─── Payments ────────────────────────────────────────────────────────────────

const createPaymentSchema = z.object({
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CHEQUE', 'OTHER']),
  amount: z.number().positive(),
  paymentDate: dateStringSchema,
  dueDate: dateStringSchema.optional(),
  reference: z.string().max(255).optional(),
  notes: z.string().max(2000).optional(),
  operationId: uuidSchema,
  deviceId: z.string().max(255).optional(),
});

const voidPaymentSchema = z.object({
  reason: z.string().min(1).max(2000),
});

// ─── Reconciliation ──────────────────────────────────────────────────────────

const createReconciliationSessionSchema = z.object({
  locationId: uuidSchema.optional(),
  periodStart: dateStringSchema,
  periodEnd: dateStringSchema,
  notes: z.string().max(2000).optional(),
});

const reconciliationVerificationSchema = z.object({
  verifications: z
    .array(
      z.object({
        batchId: uuidSchema.optional(),
        physicalKg: z.number().nonnegative(),
        notes: z.string().max(1000).optional(),
      }),
    )
    .min(1),
});

const reconciliationAdjustmentSchema = stockAdjustmentSchema;

const closeReconciliationSchema = z.object({
  notes: z.string().max(2000).optional(),
});

// ─── Sync ────────────────────────────────────────────────────────────────────

const syncPushSchema = z.object({
  operations: z
    .array(
      z.object({
        operationId: uuidSchema,
        entityType: z.string().min(1).max(100),
        entityId: uuidSchema,
        operationType: z.enum([
          'CREATE',
          'UPDATE',
          'DELETE',
          'APPROVE',
          'CONFIRM',
          'COMPLETE',
          'VOID',
        ]),
        baseVersion: z.number().int().nonnegative(),
        payload: z.record(z.unknown()),
        deviceId: z.string().min(1).max(255),
        createdAt: z.string().datetime(),
      }),
    )
    .min(1),
});

const syncPullSchema = z.object({
  deviceId: z.string().min(1).max(255),
  lastSyncAt: z.string().datetime().optional(),
  entityTypes: z.array(z.string()).optional(),
});

const resolveConflictSchema = z.object({
  resolution: z.enum(['USE_LOCAL', 'USE_SERVER', 'MANUAL']),
  mergedPayload: z.record(z.unknown()).optional(),
  notes: z.string().max(2000).optional(),
});

// ─── Reports ─────────────────────────────────────────────────────────────────

const dateRangeSchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  agentId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
});

module.exports = {
  uuidSchema,
  kgSchema,
  moneySchema,
  dateStringSchema,
  paginationSchema,
  loginSchema,
  refreshTokenSchema,
  createUserSchema,
  updateUserSchema,
  createAgentSchema,
  updateAgentSchema,
  createLocationSchema,
  createCoffeeTypeSchema,
  purchaseItemSchema,
  createPurchaseSchema,
  updatePurchaseSchema,
  rejectPurchaseSchema,
  approvePurchaseSchema,
  stockAdjustmentSchema,
  transferSchema,
  createProcessingRunSchema,
  addProcessingInputSchema,
  addProcessingOutputSchema,
  completeProcessingSchema,
  saleItemSchema,
  createSaleSchema,
  confirmSaleSchema,
  createPaymentSchema,
  voidPaymentSchema,
  createReconciliationSessionSchema,
  reconciliationVerificationSchema,
  reconciliationAdjustmentSchema,
  closeReconciliationSchema,
  syncPushSchema,
  syncPullSchema,
  resolveConflictSchema,
  dateRangeSchema,
};
