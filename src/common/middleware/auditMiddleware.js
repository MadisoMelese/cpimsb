'use strict';

/**
 * Audit logging middleware.
 * Automatically logs important mutations after they complete.
 *
 * Covered actions (detected by method + path pattern):
 *   POST /purchases/:id/approve  → PURCHASE_APPROVED
 *   POST /purchases/:id/reject   → PURCHASE_REJECTED
 *   POST /sales/:id/confirm      → SALE_CONFIRMED
 *   POST /processing/:id/complete → PROCESSING_COMPLETED
 *   POST /payments/...           → PAYMENT_CREATED
 *   POST /payments/:id/void      → PAYMENT_VOIDED
 *   POST /reconciliation/sessions/:id/close → RECONCILIATION_CLOSED
 *   POST /sync/conflicts/:id/resolve → CONFLICT_RESOLVED
 *   POST /inventory/adjustments  → STOCK_ADJUSTED
 *   POST /users                  → USER_CREATED
 *   PATCH /users/:id             → USER_UPDATED
 */

const auditService = require('../../modules/audit/audit.service');

// Pattern map: [method, pathRegex] → actionName
const AUDIT_PATTERNS = [
  [/POST/, /\/purchases\/[^/]+\/approve$/,        'PURCHASE_APPROVED'],
  [/POST/, /\/purchases\/[^/]+\/reject$/,         'PURCHASE_REJECTED'],
  [/POST/, /\/purchases\/[^/]+\/submit$/,         'PURCHASE_SUBMITTED'],
  [/POST/, /\/purchases\/[^/]+\/verify$/,         'PURCHASE_VERIFIED'],
  [/POST/, /\/sales\/[^/]+\/confirm$/,            'SALE_CONFIRMED'],
  [/POST/, /\/sales\/[^/]+\/cancel$/,             'SALE_CANCELLED'],
  [/POST/, /\/processing\/[^/]+\/complete$/,      'PROCESSING_COMPLETED'],
  [/POST/, /\/payments\/purchases\/.+/,           'PURCHASE_PAYMENT_CREATED'],
  [/POST/, /\/payments\/sales\/.+/,               'SALE_RECEIPT_CREATED'],
  [/POST/, /\/payments\/[^/]+\/void$/,            'PAYMENT_VOIDED'],
  [/POST/, /\/reconciliation\/sessions\/[^/]+\/close$/, 'RECONCILIATION_CLOSED'],
  [/POST/, /\/sync\/conflicts\/[^/]+\/resolve$/,  'SYNC_CONFLICT_RESOLVED'],
  [/POST/, /\/inventory\/adjustments$/,           'STOCK_ADJUSTED'],
  [/POST/, /\/inventory\/transfers$/,             'STOCK_TRANSFERRED'],
  [/POST/, /\/users$/,                            'USER_CREATED'],
  [/PATCH/, /\/users\/[^/]+$/,                    'USER_UPDATED'],
  [/POST/, /\/users\/[^/]+\/change-password$/,    'PASSWORD_CHANGED'],
  [/DELETE/, /\/agents\/[^/]+$/,                  'AGENT_DEACTIVATED'],
];

function detectAction(method, path) {
  for (const [methodRe, pathRe, action] of AUDIT_PATTERNS) {
    if (methodRe.test(method) && pathRe.test(path)) return action;
  }
  return null;
}

/**
 * Extracts the entity ID from the URL path.
 * e.g. /purchases/uuid-here/approve → uuid-here
 */
function extractEntityId(path) {
  const match = path.match(/\/([0-9a-f-]{36})/i);
  return match ? match[1] : null;
}

function auditMiddleware(req, res, next) {
  const action = detectAction(req.method, req.path);
  if (!action) return next();

  // Intercept response to log only on success
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    originalJson(body);

    if (res.statusCode >= 200 && res.statusCode < 300) {
      const entityId = extractEntityId(req.path);

      // Fire-and-forget — never let audit failure affect the response
      auditService.log({
        userId:      req.user?.id,
        action,
        entityType:  deriveEntityType(req.path),
        entityId,
        newValue:    body?.data ? sanitizeForAudit(body.data) : null,
        ipAddress:   req.ip || req.socket?.remoteAddress,
        deviceId:    req.headers['x-device-id'] || null,
        operationId: req.body?.operationId || null,
        requestId:   req.requestId,
      }).catch(() => {}); // already handled inside auditService.log
    }
  };

  next();
}

function deriveEntityType(path) {
  const segments = path.split('/').filter(Boolean);
  // Remove API prefix and get first meaningful segment
  const apiIdx = segments.indexOf('api');
  const start  = apiIdx >= 0 ? apiIdx + 1 : 0;
  return segments[start] || 'unknown';
}

function sanitizeForAudit(data) {
  if (!data || typeof data !== 'object') return data;
  // Remove sensitive fields from audit log values
  const { passwordHash, token, refreshToken, ...safe } = data;
  return safe;
}

module.exports = { auditMiddleware };
