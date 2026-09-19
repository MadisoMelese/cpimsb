'use strict';

const prisma = require('../../database/prismaClient');
const { NotFoundError, ConflictError } = require('../../common/errors/AppError');

async function createLocation(data) {
  const existing = await prisma.location.findUnique({ where: { code: data.code } });
  if (existing) throw new ConflictError('DUPLICATE_LOCATION_CODE', `Location code ${data.code} already exists`);
  return prisma.location.create({ data });
}

async function listLocations() {
  return prisma.location.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
}

async function getLocationById(id) {
  const loc = await prisma.location.findUnique({ where: { id } });
  if (!loc) throw new NotFoundError('Location', id);
  return loc;
}

async function updateLocation(id, data) {
  await getLocationById(id);
  return prisma.location.update({ where: { id }, data });
}

module.exports = { createLocation, listLocations, getLocationById, updateLocation };
