'use strict';

const { v4: uuidv4 } = require('uuid');
const prisma = require('../../database/prismaClient');

/**
 * Creates an immutable audit log entry.
 * NEVER throws — audit logging must not fail the main operation.
 */
async function log({
  userId,
  action,
  entityType,
  entityId,
  previousValue,
  newValue,
  ipAddress,
  deviceId,
  operationId,
  requestId,
  notes,
}) {
  try {
    await prisma.auditLog.create({
      data: {
        id:            uuidv4(),
        userId:        userId || null,
        action,
        entityType,
        entityId:      entityId || null,
        previousValue: previousValue || null,
        newValue:      newValue || null,
        ipAddress:     ipAddress || null,
        deviceId:      deviceId || null,
        operationId:   operationId || null,
        requestId:     requestId || null,
        notes:         notes || null,
      },
    });
  } catch (err) {
    // Audit failures must never break the main request
    const logger = require('../../common/logger');
    logger.error({ err }, 'Failed to write audit log entry');
  }
}

async function listLogs(query) {
  const { page = 1, limit = 100 } = query;
  const where = {};
  if (query.userId)     where.userId     = query.userId;
  if (query.entityType) where.entityType = query.entityType;
  if (query.entityId)   where.entityId   = query.entityId;
  if (query.action)     where.action     = query.action;
  if (query.startDate || query.endDate) {
    where.createdAt = {};
    if (query.startDate) where.createdAt.gte = new Date(query.startDate);
    if (query.endDate)   where.createdAt.lte = new Date(query.endDate);
  }

  const [logs, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip:  (page - 1) * limit,
      take:  parseInt(limit),
      include: { user: { select: { fullName: true, username: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { data: logs, total, page: parseInt(page), limit: parseInt(limit) };
}

module.exports = { log, listLogs };
