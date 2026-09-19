'use strict';

/**
 * Base application error.
 * All domain errors extend this so we can produce consistent API responses.
 */
class AppError extends Error {
  /**
   * @param {string} code     - Domain error code e.g. INSUFFICIENT_BATCH_STOCK
   * @param {string} message  - Human-readable message
   * @param {number} status   - HTTP status code
   * @param {object} [details] - Optional structured details
   */
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

// ─── Domain error factories ────────────────────────────────────────────────

class ValidationError extends AppError {
  constructor(message, details = {}) {
    super('VALIDATION_ERROR', message, 422, details);
    this.name = 'ValidationError';
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super('AUTHENTICATION_REQUIRED', message, 401);
    this.name = 'AuthenticationError';
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super('AUTHORIZATION_DENIED', message, 403);
    this.name = 'AuthorizationError';
  }
}

class NotFoundError extends AppError {
  constructor(entity, id) {
    super('NOT_FOUND', `${entity} not found${id ? `: ${id}` : ''}`, 404);
    this.name = 'NotFoundError';
  }
}

class ConflictError extends AppError {
  constructor(code, message, details = {}) {
    super(code, message, 409, details);
    this.name = 'ConflictError';
  }
}

class BusinessRuleError extends AppError {
  constructor(code, message, details = {}) {
    super(code, message, 422, details);
    this.name = 'BusinessRuleError';
  }
}

class InsufficientStockError extends AppError {
  constructor(batchId, requested, available) {
    super(
      'INSUFFICIENT_BATCH_STOCK',
      `Requested ${requested} KG exceeds available ${available} KG in batch ${batchId}`,
      422,
      { batchId, requested, available },
    );
    this.name = 'InsufficientStockError';
  }
}

class LockedPeriodError extends AppError {
  constructor(date, periodStart, periodEnd) {
    super(
      'LOCKED_PERIOD',
      `Cannot post entry for ${date}: period ${periodStart}–${periodEnd} is locked`,
      422,
      { date, periodStart, periodEnd },
    );
    this.name = 'LockedPeriodError';
  }
}

class IdempotencyConflictError extends AppError {
  constructor(operationId) {
    super(
      'IDEMPOTENT_OPERATION_ALREADY_APPLIED',
      `Operation ${operationId} has already been applied`,
      409,
      { operationId },
    );
    this.name = 'IdempotencyConflictError';
  }
}

class InvalidStatusTransitionError extends AppError {
  constructor(entity, from, to) {
    super(
      'INVALID_STATUS_TRANSITION',
      `Cannot transition ${entity} from ${from} to ${to}`,
      422,
      { from, to },
    );
    this.name = 'InvalidStatusTransitionError';
  }
}

class ProcessingOutputExceedsInputError extends AppError {
  constructor(outputKg, inputKg) {
    super(
      'PROCESSING_OUTPUT_EXCEEDS_INPUT',
      `Output KG (${outputKg}) cannot exceed total input KG (${inputKg})`,
      422,
      { outputKg, inputKg },
    );
    this.name = 'ProcessingOutputExceedsInputError';
  }
}

class OverpaymentError extends AppError {
  constructor(paymentAmount, remainingAmount, transactionId) {
    super(
      'OVERPAYMENT_NOT_ALLOWED',
      `Payment of ${paymentAmount} exceeds remaining balance of ${remainingAmount}`,
      422,
      { paymentAmount, remainingAmount, transactionId },
    );
    this.name = 'OverpaymentError';
  }
}

class SyncConflictDetectedError extends AppError {
  constructor(entityType, entityId, localVersion, serverVersion) {
    super(
      'SYNC_CONFLICT_DETECTED',
      `Conflict detected for ${entityType} ${entityId}: local v${localVersion} vs server v${serverVersion}`,
      409,
      { entityType, entityId, localVersion, serverVersion },
    );
    this.name = 'SyncConflictDetectedError';
  }
}

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  BusinessRuleError,
  InsufficientStockError,
  LockedPeriodError,
  IdempotencyConflictError,
  InvalidStatusTransitionError,
  ProcessingOutputExceedsInputError,
  OverpaymentError,
  SyncConflictDetectedError,
};
