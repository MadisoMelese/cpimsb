'use strict';

const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const prisma  = require('../../database/prismaClient');
const config  = require('../../config');
const {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
} = require('../../common/errors/AppError');

const BCRYPT_ROUNDS = 12;

// ─── Token helpers ────────────────────────────────────────────────────────────

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, username: user.username },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiresIn },
  );
}

function signRefreshToken(userId, tokenId) {
  return jwt.sign(
    { sub: userId, jti: tokenId },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn },
  );
}

function hashToken(token) {
  // We store a hash of the refresh token to prevent exposure from DB leaks
  return bcrypt.hashSync(token, 4); // fast hash for token storage, security is in the secret
}

// ─── Service ──────────────────────────────────────────────────────────────────

async function login(email, password, deviceId = null) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.isActive) {
    throw new AuthenticationError('Invalid email or password');
  }

  const passwordMatch = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatch) {
    throw new AuthenticationError('Invalid email or password');
  }

  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), deviceId },
  });

  const accessToken  = signAccessToken(user);
  const tokenId      = uuidv4();
  const refreshToken = signRefreshToken(user.id, tokenId);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await prisma.refreshToken.create({
    data: {
      id: tokenId,
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      deviceId,
      expiresAt,
    },
  });

  return {
    accessToken,
    refreshToken,
    user: sanitizeUser(user),
  };
}

async function refreshAccessToken(rawRefreshToken) {
  let decoded;
  try {
    decoded = jwt.verify(rawRefreshToken, config.jwt.refreshSecret);
  } catch {
    throw new AuthenticationError('Invalid or expired refresh token');
  }

  const stored = await prisma.refreshToken.findUnique({ where: { id: decoded.jti } });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new AuthenticationError('Refresh token is no longer valid');
  }

  // Verify token hash matches stored hash
  const matches = await bcrypt.compare(rawRefreshToken, stored.tokenHash);
  if (!matches) {
    throw new AuthenticationError('Invalid refresh token');
  }

  const user = await prisma.user.findUnique({ where: { id: stored.userId } });
  if (!user || !user.isActive) {
    throw new AuthenticationError('User account is inactive');
  }

  // Rotate — revoke old token, issue new pair
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const newAccessToken  = signAccessToken(user);
  const newTokenId      = uuidv4();
  const newRefreshToken = signRefreshToken(user.id, newTokenId);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await prisma.refreshToken.create({
    data: {
      id: newTokenId,
      userId: user.id,
      tokenHash: hashToken(newRefreshToken),
      deviceId: stored.deviceId,
      expiresAt,
    },
  });

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

async function logout(rawRefreshToken) {
  let decoded;
  try {
    decoded = jwt.verify(rawRefreshToken, config.jwt.refreshSecret);
  } catch {
    // Even if expired, we try to revoke
    return;
  }

  await prisma.refreshToken.updateMany({
    where: { id: decoded.jti, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

function sanitizeUser(user) {
  const { passwordHash: _, ...safe } = user;
  return safe;
}

module.exports = { login, refreshAccessToken, logout, hashPassword, sanitizeUser };
