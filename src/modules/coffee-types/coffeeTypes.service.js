'use strict';

const prisma = require('../../database/prismaClient');
const { NotFoundError, ConflictError } = require('../../common/errors/AppError');

async function createCoffeeType(data) {
  const existing = await prisma.coffeeType.findUnique({ where: { code: data.code } });
  if (existing) throw new ConflictError('DUPLICATE_COFFEE_TYPE_CODE', `Code ${data.code} already exists`);
  return prisma.coffeeType.create({ data });
}

async function listCoffeeTypes(query = {}) {
  const where = { isActive: true };
  if (query.state) where.state = query.state;
  return prisma.coffeeType.findMany({ where, orderBy: { name: 'asc' } });
}

async function getCoffeeTypeById(id) {
  const ct = await prisma.coffeeType.findUnique({ where: { id } });
  if (!ct) throw new NotFoundError('CoffeeType', id);
  return ct;
}

async function updateCoffeeType(id, data) {
  await getCoffeeTypeById(id);
  return prisma.coffeeType.update({ where: { id }, data });
}

module.exports = { createCoffeeType, listCoffeeTypes, getCoffeeTypeById, updateCoffeeType };
