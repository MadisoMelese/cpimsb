'use strict';

const authService = require('./auth.service');
const prisma      = require('../../database/prismaClient');
const config      = require('../../config');

async function login(req, res, next) {
  try {
    const { email, password, deviceId } = req.body;
    const result = await authService.login(email, password, deviceId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;
    const result = await authService.refreshAccessToken(refreshToken);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body || {};
    if (refreshToken) {
      await authService.logout(refreshToken);
    }
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, username: true, email: true, role: true,
        fullName: true, isActive: true, lastLoginAt: true, createdAt: true,
      },
    });
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    // Derive app base URL from request so it works in any environment
    const appBaseUrl = req.headers.origin || `${req.protocol}://${req.get('host')}`.replace(/\/api$/, '');
    await authService.requestPasswordReset(email, appBaseUrl);
    // Always 200 — never reveal whether the email exists
    res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const { token, password } = req.body;
    await authService.resetPasswordByToken(token, password);
    res.json({ success: true, message: 'Password reset successfully. You can now sign in.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { login, refresh, logout, me, forgotPassword, resetPassword };