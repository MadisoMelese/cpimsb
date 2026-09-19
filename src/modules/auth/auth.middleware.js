'use strict';

const jwt = require('jsonwebtoken');
const config = require('../../config');
const { AuthenticationError, AuthorizationError } = require('../../common/errors/AppError');

/**
 * Verifies the JWT access token on every protected route.
 * Attaches req.user = { id, role, username } on success.
 */
function authenticate(req, _res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AuthenticationError('Authorization header missing or malformed'));
  }

  const token = authHeader.slice(7);
  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.accessSecret);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new AuthenticationError('Access token has expired'));
    }
    return next(new AuthenticationError('Invalid access token'));
  }

  req.user = {
    id:       decoded.sub,
    role:     decoded.role,
    username: decoded.username,
  };
  return next();
}

/**
 * Role-based authorization guard.
 * Usage: authorize('BOSS', 'ADMIN')
 * The server ALWAYS determines authorization — never the client.
 */
function authorize(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AuthenticationError());
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AuthorizationError(
          `Role ${req.user.role} is not authorized for this operation. ` +
            `Required: ${allowedRoles.join(' or ')}`,
        ),
      );
    }
    return next();
  };
}

/**
 * Verifies the requesting user is either the target user or has a privileged role.
 * Useful for profile endpoints.
 */
function authorizeOwnerOrAdmin(req, _res, next) {
  const { id: requestingId, role } = req.user;
  const targetId = req.params.id;

  if (requestingId === targetId || role === 'BOSS' || role === 'ADMIN') {
    return next();
  }
  return next(new AuthorizationError('You can only access your own account'));
}

module.exports = { authenticate, authorize, authorizeOwnerOrAdmin };
