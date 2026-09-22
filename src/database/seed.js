'use strict';

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();

async function seed() {
  console.log('Seeding database...');

  // ─── Sequence counters ────────────────────────────────────────────────────
  const sequences = ['purchase', 'sale', 'processing_run', 'payment', 'adjustment', 'transfer', 'reconciliation', 'batch'];
  for (const name of sequences) {
    await prisma.sequenceCounter.upsert({
      where:  { name },
      update: {},
      create: { name, lastValue: 0 },
    });
  }

  // ─── Users ────────────────────────────────────────────────────────────────
  const adminPassword = await bcrypt.hash('Admin1234!', 12);
  await prisma.user.upsert({
    where:  { username: 'admin' },
    update: {},
    create: {
      id:           uuidv4(),
      username:     'admin',
      email:        'admin@cpims.local',
      passwordHash: adminPassword,
      role:         'BOSS',
      fullName:     'System Administrator',
    },
  });

  const skPassword = await bcrypt.hash('Store1234!', 12);
  await prisma.user.upsert({
    where:  { username: 'storekeeper' },
    update: {},
    create: {
      id:           uuidv4(),
      username:     'storekeeper',
      email:        'storekeeper@cpims.local',
      passwordHash: skPassword,
      role:         'STOREKEEPER',
      fullName:     'Default Storekeeper',
    },
  });

  // ─── Locations ────────────────────────────────────────────────────────────
  // Reception stations where agents deliver coffee
  await prisma.location.upsert({
    where:  { code: 'REC-MAIN' },
    update: {},
    create: { id: uuidv4(), code: 'REC-MAIN', name: 'Main Reception Station',  description: 'Primary wet coffee intake point' },
  });
  await prisma.location.upsert({
    where:  { code: 'REC-NORTH' },
    update: {},
    create: { id: uuidv4(), code: 'REC-NORTH', name: 'North Reception Station', description: 'Northern zone intake point' },
  });
  await prisma.location.upsert({
    where:  { code: 'REC-SOUTH' },
    update: {},
    create: { id: uuidv4(), code: 'REC-SOUTH', name: 'South Reception Station', description: 'Southern zone intake point' },
  });
  await prisma.location.upsert({
    where:  { code: 'WH-MAIN' },
    update: {},
    create: { id: uuidv4(), code: 'WH-MAIN', name: 'Main Warehouse', description: 'Primary dry coffee storage' },
  });
  await prisma.location.upsert({
    where:  { code: 'DS-01' },
    update: {},
    create: { id: uuidv4(), code: 'DS-01', name: 'Drying Station 1', description: 'Sun-drying beds — block A' },
  });
  await prisma.location.upsert({
    where:  { code: 'DS-02' },
    update: {},
    create: { id: uuidv4(), code: 'DS-02', name: 'Drying Station 2', description: 'Sun-drying beds — block B' },
  });

  // ─── Coffee types ──────────────────────────────────────────────────────────
  // Grade = rank (1 = highest, 2 = medium, 3 = lower)
  const coffeeTypes = [
    // Wet cherry — received directly from agents (what storekeeper records)
    { code: 'CW-G1', name: 'Cherry Wet Grade 1',    grade: '1', state: 'WET',       description: 'Highest quality wet cherry — uniform size, <3% defects' },
    { code: 'CW-G2', name: 'Cherry Wet Grade 2',    grade: '2', state: 'WET',       description: 'Medium quality wet cherry — 3–10% defects' },
    { code: 'CW-G3', name: 'Cherry Wet Grade 3',    grade: '3', state: 'WET',       description: 'Lower quality wet cherry — >10% defects' },
    // Dry cherry — sun-dried received from agents
    { code: 'CD-G1', name: 'Cherry Dry Grade 1',    grade: '1', state: 'DRY',       description: 'Highest quality sun-dried cherry' },
    { code: 'CD-G2', name: 'Cherry Dry Grade 2',    grade: '2', state: 'DRY',       description: 'Medium quality sun-dried cherry' },
    { code: 'CD-G3', name: 'Cherry Dry Grade 3',    grade: '3', state: 'DRY',       description: 'Lower quality sun-dried cherry' },
    // Parchment — output after wet processing (Admin only)
    { code: 'CP-G1', name: 'Parchment Grade 1',     grade: '1', state: 'PARCHMENT', description: 'Wet-processed parchment — Grade 1' },
    { code: 'CP-G2', name: 'Parchment Grade 2',     grade: '2', state: 'PARCHMENT', description: 'Wet-processed parchment — Grade 2' },
    // Green bean — output after hulling (Admin only)
    { code: 'CG-G1', name: 'Green Bean Grade 1',    grade: '1', state: 'GREEN',     description: 'Green bean ready for export — Grade 1' },
    { code: 'CG-G2', name: 'Green Bean Grade 2',    grade: '2', state: 'GREEN',     description: 'Green bean ready for export — Grade 2' },
    { code: 'CG-G3', name: 'Green Bean Grade 3',    grade: '3', state: 'GREEN',     description: 'Green bean — Grade 3' },
    // Legacy AA/AB codes
    { code: 'CW-AA', name: 'Cherry Wet Grade AA',   grade: 'AA', state: 'WET',      description: 'Wet cherry — AA classification' },
    { code: 'CD-AA', name: 'Parchment Dry Grade AA',grade: 'AA', state: 'DRY',      description: 'Dry parchment — AA classification' },
    { code: 'CD-AB', name: 'Parchment Dry Grade AB',grade: 'AB', state: 'DRY',      description: 'Dry parchment — AB classification' },
  ];

  for (const ct of coffeeTypes) {
    await prisma.coffeeType.upsert({
      where:  { code: ct.code },
      update: { name: ct.name, grade: ct.grade, description: ct.description },
      create: { id: uuidv4(), ...ct },
    });
  }

  // ─── Agents (coffee suppliers) ────────────────────────────────────────────
  const agents = [
    { code: 'AGT-001', name: 'Abebe Kebede',       phone: '+251911000001', address: 'Jimma Zone, Oromia' },
    { code: 'AGT-002', name: 'Tigist Haile',        phone: '+251911000002', address: 'Kaffa Zone, SNNPR' },
    { code: 'AGT-003', name: 'Mulugeta Tesfaye',    phone: '+251911000003', address: 'Gedeo Zone, SNNPR' },
    { code: 'AGT-004', name: 'Selamawit Girma',     phone: '+251911000004', address: 'West Hararghe, Oromia' },
    { code: 'AGT-005', name: 'Dawit Bekele',        phone: '+251911000005', address: 'Bench Sheko, SNNPR' },
    { code: 'AGT-006', name: 'Meseret Alemu',       phone: '+251911000006', address: 'Jimma Zone, Oromia' },
    // Customer (coffee buyer)
    { code: 'CUS-001', name: 'Addis Coffee Exchange', phone: '+251115000010', address: 'Addis Ababa, Ethiopia', isSupplier: false, isCustomer: true },
    { code: 'CUS-002', name: 'ECX Export Hub',        phone: '+251115000011', address: 'Addis Ababa, Ethiopia', isSupplier: false, isCustomer: true },
  ];

  for (const a of agents) {
    await prisma.agent.upsert({
      where:  { code: a.code },
      update: { name: a.name, phone: a.phone, address: a.address },
      create: {
        id:         uuidv4(),
        code:       a.code,
        name:       a.name,
        phone:      a.phone,
        address:    a.address || null,
        isSupplier: a.isSupplier !== false,
        isCustomer: a.isCustomer === true,
      },
    });
  }

  console.log('✓ Seed completed successfully.');
  console.log('  Admin     → email: admin@cpims.local        password: Admin1234!');
  console.log('  Keeper    → email: storekeeper@cpims.local  password: Store1234!');
  console.log(`  Coffee types: ${coffeeTypes.length} | Agents: ${agents.filter(a => a.isSupplier !== false).length} suppliers, ${agents.filter(a => a.isCustomer).length} customers`);
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
