'use strict';

const express     = require('express');
const cors        = require('cors');
const compression = require('compression');
const YAML        = require('yamljs');
const swaggerUi   = require('swagger-ui-express');
const path        = require('path');

const config  = require('./config');
const logger  = require('./common/logger');

// ─── Security middleware ────────────────────────────────────────────────────
const {
  helmetMiddleware,
  globalRateLimiter,
  authRateLimiter,
  mutationRateLimiter,
  syncRateLimiter,
} = require('./common/middleware/security');
const { sanitizeInputs }   = require('./common/middleware/sanitize');
const { requestIdMiddleware } = require('./common/middleware/requestId');
const { requestLogger }       = require('./common/middleware/requestLogger');
const { auditMiddleware }      = require('./common/middleware/auditMiddleware');
const { errorHandler }         = require('./common/middleware/errorHandler');

// ─── Route modules ──────────────────────────────────────────────────────────
const authRoutes           = require('./modules/auth/auth.routes');
const usersRoutes          = require('./modules/users/users.routes');
const agentsRoutes         = require('./modules/agents/agents.routes');
const locationsRoutes      = require('./modules/locations/locations.routes');
const coffeeTypesRoutes    = require('./modules/coffee-types/coffeeTypes.routes');
const purchasesRoutes      = require('./modules/purchases/purchases.routes');
const inventoryRoutes      = require('./modules/inventory/inventory.routes');
const processingRoutes     = require('./modules/processing/processing.routes');
const salesRoutes          = require('./modules/sales/sales.routes');
const paymentsRoutes       = require('./modules/payments/payments.routes');
const reconciliationRoutes = require('./modules/reconciliation/reconciliation.routes');
const syncRoutes           = require('./modules/sync/sync.routes');
const reportsRoutes        = require('./modules/reports/reports.routes');
const advancesRoutes       = require('./modules/advances/advances.routes');
const auditRoutes          = require('./modules/audit/audit.routes');

// ─── App ─────────────────────────────────────────────────────────────────────

const app = express();

// 1. Trust proxy (needed for rate limiter to see real IPs behind reverse proxy)
if (config.isProd) {
  app.set('trust proxy', 1);
}

// 2. Secure HTTP headers (Helmet)
app.use(helmetMiddleware);

// 3. CORS
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, server-to-server) in dev
    if (!origin || config.isDev) return cb(null, true);
    if (config.cors.origins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: Origin ${origin} not allowed`));
  },
  credentials: true,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Device-Id'],
  exposedHeaders: ['X-Request-Id'],
}));

// 4. Request ID — must be before rate limiter so logs are traceable
app.use(requestIdMiddleware);

// 5. Global rate limit
app.use(globalRateLimiter);

// 6. Body parsing — limited to 2MB to prevent request amplification
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(compression());

// 7. Input sanitization (null-byte stripping, over-length warnings)
app.use(sanitizeInputs);

// 8. Request logger
app.use(requestLogger);

// 9. Audit middleware (fires on successful mutations)
app.use(auditMiddleware);

// ─── Health check (unauthenticated, not rate-limited) ────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'cpims-backend', time: new Date().toISOString() });
});

// ─── API routes with targeted rate limiters ───────────────────────────────────

const api = config.apiPrefix;

// Auth: strict rate limit on login (brute force protection)
app.use(`${api}/auth/login`,   authRateLimiter);
app.use(`${api}/auth/refresh`, authRateLimiter);
app.use(`${api}/auth`,         authRoutes);

// Sync: per-device rate limit
app.use(`${api}/sync/push`,    syncRateLimiter);
app.use(`${api}/sync`,         syncRoutes);

// Mutation rate limit on approval/payment/processing endpoints
app.use(`${api}/purchases`,    mutationRateLimiter, purchasesRoutes);
app.use(`${api}/sales`,        mutationRateLimiter, salesRoutes);
app.use(`${api}/payments`,     mutationRateLimiter, paymentsRoutes);
app.use(`${api}/processing`,   mutationRateLimiter, processingRoutes);
app.use(`${api}/inventory`,    mutationRateLimiter, inventoryRoutes);
app.use(`${api}/reconciliation`, mutationRateLimiter, reconciliationRoutes);

// Standard limit for reference/read routes
app.use(`${api}/advances`,       mutationRateLimiter, advancesRoutes);
app.use(`${api}/users`,        usersRoutes);
app.use(`${api}/agents`,       agentsRoutes);
app.use(`${api}/locations`,    locationsRoutes);
app.use(`${api}/coffee-types`, coffeeTypesRoutes);
app.use(`${api}/reports`,      reportsRoutes);
app.use(`${api}/audit`,        auditRoutes);

// ─── Swagger UI (development only) ───────────────────────────────────────────

if (!config.isProd) {
  try {
    const swaggerDoc = YAML.load(path.join(__dirname, '../docs/openapi.yaml'));
    app.use(`${api}/docs`, swaggerUi.serve, swaggerUi.setup(swaggerDoc, {
      swaggerOptions: { persistAuthorization: true },
    }));
    logger.info(`Swagger UI available at ${api}/docs`);
  } catch {
    logger.warn('OpenAPI spec not found at docs/openapi.yaml — Swagger UI disabled');
  }
}

// ─── 404 handler ─────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Route not found', details: {} },
  });
});

// ─── Global error handler ─────────────────────────────────────────────────────

app.use(errorHandler);

module.exports = app;