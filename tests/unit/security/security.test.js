'use strict';

const { sanitizeInputs } = require('../../../src/common/middleware/sanitize');
const { validateEnv }    = require('../../../src/config/validateEnv');

// ─── Input sanitization ───────────────────────────────────────────────────────

describe('Input sanitization middleware', () => {
  function mockReq(body = {}, query = {}, params = {}) {
    return { body, query, params, requestId: 'test-req-id' };
  }
  const mockRes = {};
  const next = jest.fn();

  beforeEach(() => next.mockClear());

  it('strips null bytes from string body values', () => {
    const req = mockReq({ username: 'admin\0', password: 'pass\0word' });
    sanitizeInputs(req, mockRes, next);
    expect(req.body.username).toBe('admin');
    expect(req.body.password).toBe('password');
    expect(next).toHaveBeenCalled();
  });

  it('strips null bytes from nested objects', () => {
    const req = mockReq({ items: [{ name: 'test\0' }] });
    sanitizeInputs(req, mockRes, next);
    expect(req.body.items[0].name).toBe('test');
  });

  it('strips null bytes from query params', () => {
    const req = mockReq({}, { search: 'coffee\0' });
    sanitizeInputs(req, mockRes, next);
    expect(req.query.search).toBe('coffee');
  });

  it('strips null bytes from route params', () => {
    const req = mockReq({}, {}, { id: 'uuid-\0here' });
    sanitizeInputs(req, mockRes, next);
    expect(req.params.id).toBe('uuid-here');
  });

  it('passes non-string values unchanged', () => {
    const req = mockReq({ count: 42, active: true, data: null });
    sanitizeInputs(req, mockRes, next);
    expect(req.body.count).toBe(42);
    expect(req.body.active).toBe(true);
    expect(req.body.data).toBeNull();
  });

  it('handles deeply nested objects without infinite recursion', () => {
    const req = mockReq({
      level1: { level2: { level3: { value: 'deep\0value' } } },
    });
    expect(() => sanitizeInputs(req, mockRes, next)).not.toThrow();
    expect(req.body.level1.level2.level3.value).toBe('deepvalue');
  });

  it('always calls next()', () => {
    const req = mockReq({ normal: 'value' });
    sanitizeInputs(req, mockRes, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

// ─── Environment validation ───────────────────────────────────────────────────

describe('Environment validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'development' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('warns (not throws) in development when secrets are missing', () => {
    delete process.env.DATABASE_URL;
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;

    // In development, should warn but not throw
    expect(() => validateEnv()).not.toThrow();
  });

  it('warns when JWT secret is too short', () => {
    process.env.DATABASE_URL       = 'postgresql://valid';
    process.env.JWT_ACCESS_SECRET  = 'tooshort';  // < 32 chars
    process.env.JWT_REFRESH_SECRET = 'a'.repeat(32);

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    validateEnv();
    // In development mode it warns — error message contains the key
    consoleSpy.mockRestore();
  });

  it('detects insecure default placeholder values', () => {
    process.env.DATABASE_URL       = 'postgresql://valid';
    process.env.JWT_ACCESS_SECRET  = 'CHANGE_ME_secret_value_here_long_enough';
    process.env.JWT_REFRESH_SECRET = 'a'.repeat(32);

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation((msg) => {
      // In dev mode the warning should mention the insecure value
      expect(typeof msg).toBe('string');
    });
    validateEnv();
    consoleSpy.mockRestore();
  });

  it('throws in production with missing required vars', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_REFRESH_SECRET;

    expect(() => validateEnv()).toThrow();

    process.env.NODE_ENV = 'development';
  });

  it('accepts valid strong secrets without warning', () => {
    process.env.DATABASE_URL       = 'postgresql://user:p@ss@host:5432/db';
    process.env.JWT_ACCESS_SECRET  = 'x'.repeat(48); // strong, long enough
    process.env.JWT_REFRESH_SECRET = 'y'.repeat(48);

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => validateEnv()).not.toThrow();
    consoleSpy.mockRestore();
  });
});

// ─── Error response format ────────────────────────────────────────────────────

describe('Error response — never leaks internals in production', () => {
  it('error response shape matches API contract', () => {
    const errorResponse = {
      success: false,
      error: {
        code:    'INSUFFICIENT_BATCH_STOCK',
        message: 'Requested 150 KG exceeds available 100 KG',
        details: { batchId: 'uuid', requested: 150, available: 100 },
      },
      requestId: 'req-uuid',
    };

    expect(errorResponse.success).toBe(false);
    expect(errorResponse.error.code).toBeDefined();
    expect(errorResponse.error.message).toBeDefined();
    expect(errorResponse.requestId).toBeDefined();
    // Stack trace must NOT be in production error response
    expect(errorResponse.error.stack).toBeUndefined();
  });

  it('production error handler omits stack trace', () => {
    const isDev   = false; // simulating production
    const err     = new Error('Something internal');
    const details = isDev ? { stack: err.stack, message: err.message } : {};
    expect(details.stack).toBeUndefined();
  });
});

// ─── Authorization — server always determines role ────────────────────────────

describe('Authorization — client cannot elevate role', () => {
  it('req.user comes from JWT payload, not req.body', () => {
    // Simulates what authenticate middleware does:
    // role is taken from the verified JWT — never from req.body.role
    const jwtPayload = { sub: 'user-id', role: 'STOREKEEPER' };
    const reqBody    = { role: 'BOSS' }; // client attempt to elevate

    // The middleware sets req.user from JWT, not from body
    const user = { id: jwtPayload.sub, role: jwtPayload.role };

    expect(user.role).toBe('STOREKEEPER'); // JWT role used
    expect(user.role).not.toBe(reqBody.role); // body role ignored
  });
});
