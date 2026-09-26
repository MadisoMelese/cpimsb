'use strict';

const prisma      = require('../../database/prismaClient');
const authService = require('../auth/auth.service');
const { NotFoundError, ConflictError } = require('../../common/errors/AppError');
const { paginate, paginatedResponse } = require('../../common/utils/pagination');

async function createUser(data) {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ username: data.username }, { email: data.email }] },
  });
  if (existing) {
    throw new ConflictError('DUPLICATE_USER', 'Username or email already in use');
  }
  const passwordHash = await authService.hashPassword(data.password);
  const user = await prisma.user.create({
    data: {
      username: data.username,
      email: data.email,
      passwordHash,
      role: data.role,
      fullName: data.fullName,
    },
  });
  return authService.sanitizeUser(user);
}

async function listUsers(query) {
  const { page, limit } = query;
  const where = {};
  if (query.role)     where.role     = query.role;
  if (query.isActive !== undefined) where.isActive = query.isActive;
  if (query.search) {
    where.OR = [
      { fullName: { contains: query.search, mode: 'insensitive' } },
      { username: { contains: query.search, mode: 'insensitive' } },
      { email:    { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      ...paginate(page, limit),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, username: true, email: true, role: true,
        fullName: true, isActive: true, lastLoginAt: true, createdAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  return paginatedResponse(users, total, page, limit);
}

async function getUserById(id) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, username: true, email: true, role: true,
      fullName: true, isActive: true, lastLoginAt: true, createdAt: true, updatedAt: true,
    },
  });
  if (!user) throw new NotFoundError('User', id);
  return user;
}

async function updateUser(id, data) {
  await getUserById(id); // throws if not found
  const user = await prisma.user.update({
    where: { id },
    data: {
      ...data,
      version: { increment: 1 },
    },
    select: {
      id: true, username: true, email: true, role: true,
      fullName: true, isActive: true, updatedAt: true, version: true,
    },
  });
  return user;
}

async function changePassword(id, newPassword) {
  const hash = await authService.hashPassword(newPassword);
  await prisma.user.update({
    where: { id },
    data: { passwordHash: hash, version: { increment: 1 } },
  });
}

module.exports = { createUser, listUsers, getUserById, updateUser, changePassword };
