'use strict';

const { v4: uuidv4 } = require('uuid');
const prisma   = require('../../database/prismaClient');
const engine   = require('../inventory/inventory.engine');
const { nextCode }  = require('../../common/utils/codeGenerator');
const config   = require('../../config');
const {
  add, subtract, multiply, divide, isGreaterThan, allocateCostProportionally, Decimal,
} = require('../../common/utils/decimal');
const {
  NotFoundError,
  BusinessRuleError,
  InvalidStatusTransitionError,
  IdempotencyConflictError,
  ProcessingOutputExceedsInputError,
} = require('../../common/errors/AppError');
const { paginate, paginatedResponse } = require('../../common/utils/pagination');

// ─── Create ───────────────────────────────────────────────────────────────────

async function createProcessingRun(data, userId) {
  const runCode = await nextCode(prisma, 'processing_run', 'PRO');

  return prisma.processingRun.create({
    data: {
      id:                 uuidv4(),
      runCode,
      status:             'DRAFT',
      locationId:         data.locationId || null,
      processingCost:     data.processingCost     || null,
      processingCostNotes: data.processingCostNotes || null,
      notes:              data.notes || null,
      createdById:        userId,
      deviceId:           data.deviceId || null,
    },
  });
}

// ─── Read ─────────────────────────────────────────────────────────────────────

async function listProcessingRuns(query) {
  const { page, limit } = query;
  const where = {};
  if (query.status) where.status = query.status;

  const [runs, total] = await prisma.$transaction([
    prisma.processingRun.findMany({
      where,
      ...paginate(page, limit),
      orderBy: { createdAt: 'desc' },
      include: {
        inputs: { include: { batch: { include: { coffeeType: true } } } },
        outputBatches: { include: { coffeeType: true } },
      },
    }),
    prisma.processingRun.count({ where }),
  ]);
  return paginatedResponse(runs, total, page, limit);
}

async function getProcessingRunById(id) {
  const run = await prisma.processingRun.findUnique({
    where: { id },
    include: {
      inputs: { include: { batch: { include: { coffeeType: true, location: true } } } },
      outputBatches: { include: { coffeeType: true, location: true } },
      lineage: {
        include: {
          inputBatch:  { include: { coffeeType: true } },
          outputBatch: { include: { coffeeType: true } },
        },
      },
      createdBy: { select: { fullName: true } },
    },
  });
  if (!run) throw new NotFoundError('ProcessingRun', id);
  return run;
}

// ─── Add inputs ───────────────────────────────────────────────────────────────

async function addInputs(id, { inputs }, userId) {
  const run = await getProcessingRunById(id);
  if (!['DRAFT', 'IN_PROGRESS'].includes(run.status)) {
    throw new InvalidStatusTransitionError('ProcessingRun', run.status, 'IN_PROGRESS');
  }

  const results = [];
  for (const input of inputs) {
    const batch = await prisma.batch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new NotFoundError('Batch', input.batchId);

    const requestedKg = new Decimal(input.quantityKg.toString());
    const remainingKg = new Decimal(batch.remainingKg.toString());

    if (isGreaterThan(requestedKg, remainingKg)) {
      throw new BusinessRuleError(
        'INSUFFICIENT_BATCH_STOCK',
        `Batch ${batch.batchCode} only has ${remainingKg} KG but ${requestedKg} KG requested`,
      );
    }

    const pi = await prisma.processingInput.create({
      data: {
        id:             uuidv4(),
        processingRunId: id,
        batchId:        input.batchId,
        quantityKg:     input.quantityKg,
        costPerKg:      batch.costPerKg,
        totalCost:      multiply(batch.costPerKg, input.quantityKg).toFixed(2),
      },
    });
    results.push(pi);
  }

  // Move to IN_PROGRESS
  if (run.status === 'DRAFT') {
    await prisma.processingRun.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
  }

  return results;
}

// ─── Complete processing ──────────────────────────────────────────────────────
/**
 * ATOMIC processing completion:
 *  1. Lock all input batches
 *  2. Validate quantities against available stock
 *  3. Validate output doesn't exceed input
 *  4. Consume input batches → stock ledger PROCESSING_CONSUMPTION entries
 *  5. Create output batches
 *  6. Create stock ledger PROCESSING_OUTPUT entries
 *  7. Create batch_lineage records
 *  8. Calculate loss and cost allocation
 *  9. Mark run COMPLETED
 */
async function completeProcessing(id, { outputs }, operationId, userId) {
  // Idempotency
  const run = await getProcessingRunById(id);
  if (run.completionOperationId === operationId) {
    return run; // already applied
  }
  if (run.status === 'COMPLETED') {
    throw new IdempotencyConflictError(operationId);
  }
  if (run.status !== 'IN_PROGRESS') {
    throw new InvalidStatusTransitionError('ProcessingRun', run.status, 'COMPLETED');
  }
  if (run.inputs.length === 0) {
    throw new BusinessRuleError('PROCESSING_NO_INPUTS', 'Cannot complete a processing run with no inputs');
  }

  return prisma.$transaction(
    async (tx) => {
      // ─ 1. Total input cost & KG from locked inputs ─
      let totalInputKg   = new Decimal(0);
      let totalInputCost = new Decimal(0);

      for (const input of run.inputs) {
        totalInputKg   = add(totalInputKg, input.quantityKg);
        totalInputCost = add(totalInputCost, input.totalCost);
      }

      // ─ 2. Total output KG ─
      let totalOutputKg = new Decimal(0);
      for (const out of outputs) {
        totalOutputKg = add(totalOutputKg, out.quantityKg);
      }

      // ─ 3. Output must not exceed input ─
      if (isGreaterThan(totalOutputKg, totalInputKg)) {
        throw new ProcessingOutputExceedsInputError(
          totalOutputKg.toNumber(),
          totalInputKg.toNumber(),
        );
      }

      // ─ 4. Consume each input batch ─
      for (const input of run.inputs) {
        await engine.consumeFromBatch(tx, {
          batchId:       input.batchId,
          quantityKg:    input.quantityKg,
          movementType:  'PROCESSING_CONSUMPTION',
          sourceRef:     { processingRunId: id },
          performedById: userId,
          operationId:   `${operationId}:consume:${input.batchId}`,
          notes:         `Processing run ${run.runCode} input consumption`,
        });
      }

      // ─ 5. Cost allocation ─
      // Total cost = sum(input batch costs) + processing overhead cost
      const processingOverhead = run.processingCost ? new Decimal(run.processingCost.toString()) : new Decimal(0);
      const totalCostToAllocate = add(totalInputCost, processingOverhead);

      // Allocate total cost proportionally by output KG
      const outputQuantities = outputs.map((o) => new Decimal(o.quantityKg.toString()));
      const allocatedCosts   = allocateCostProportionally(totalCostToAllocate, outputQuantities);

      // ─ 6. Create output batches + ledger entries ─
      const outputBatches = [];
      for (let i = 0; i < outputs.length; i++) {
        const out     = outputs[i];
        const outCost = allocatedCosts[i];
        const outQty  = new Decimal(out.quantityKg.toString());
        const costPerKg = outQty.isZero() ? new Decimal(0) : divide(outCost, outQty);

        const batchCode = await nextCode(prisma, 'batch', 'BAT');

        const newBatch = await tx.batch.create({
          data: {
            id:             uuidv4(),
            batchCode,
            coffeeTypeId:   out.coffeeTypeId,
            locationId:     out.locationId || run.locationId,
            originalKg:     out.quantityKg,
            remainingKg:    out.quantityKg,
            costPerKg:      costPerKg.toFixed(4),
            totalCost:      outCost.toFixed(2),
            processingRunId: id,
            status:         'ACTIVE',
            createdById:    userId,
            notes:          out.notes || null,
          },
        });

        await engine.createLedgerEntry(tx, {
          batchId:        newBatch.id,
          locationId:     out.locationId || run.locationId,
          quantityKg:     out.quantityKg,
          movementType:   'PROCESSING_OUTPUT',
          processingRunId: id,
          performedById:  userId,
          operationId:    `${operationId}:output:${i}`,
          notes:          `Processing run ${run.runCode} output`,
        });

        outputBatches.push(newBatch);
      }

      // ─ 7. Batch lineage — map each input to each output proportionally ─
      for (const input of run.inputs) {
        const inputFraction = divide(
          new Decimal(input.quantityKg.toString()),
          totalInputKg,
        );

        for (let i = 0; i < outputBatches.length; i++) {
          const outBatch = outputBatches[i];
          const outQty   = new Decimal(outputs[i].quantityKg.toString());
          const creditKg = multiply(inputFraction, outQty);

          await tx.batchLineage.create({
            data: {
              id:             uuidv4(),
              processingRunId: id,
              inputBatchId:   input.batchId,
              outputBatchId:  outBatch.id,
              inputKgUsed:    multiply(inputFraction, new Decimal(input.quantityKg.toString())).toFixed(3),
              outputKgCredit: creditKg.toFixed(3),
            },
          });
        }
      }

      // ─ 8. Calculate loss & check range ─
      const lossKg  = subtract(totalInputKg, totalOutputKg);
      const lossPct = totalInputKg.isZero()
        ? new Decimal(0)
        : divide(lossKg, totalInputKg).times(100);

      const lossOutOfRange =
        lossPct.lessThan(config.processing.lossMinPct) ||
        lossPct.greaterThan(config.processing.lossMaxPct);

      // ─ 9. Finalize run ─
      const completed = await tx.processingRun.update({
        where: { id },
        data: {
          status:               'COMPLETED',
          completedAt:          new Date(),
          totalInputKg:         totalInputKg.toFixed(3),
          totalOutputKg:        totalOutputKg.toFixed(3),
          lossKg:               lossKg.toFixed(3),
          lossPct:              lossPct.toFixed(4),
          lossOutOfRange,
          completionOperationId: operationId,
          version:              { increment: 1 },
        },
        include: { outputBatches: true, inputs: true },
      });

      return completed;
    },
    { isolationLevel: 'Serializable', timeout: 60_000 },
  );
}

/**
 * Cancel a processing run.
 * - Only DRAFT or IN_PROGRESS runs can be cancelled.
 * - If inputs were already consumed from batches, they are restored via reversal ledger entries.
 */
async function cancelProcessingRun(id, userId) {
  const run = await getProcessingRunById(id);

  if (!['DRAFT', 'IN_PROGRESS'].includes(run.status)) {
    throw new InvalidStatusTransitionError('ProcessingRun', run.status, 'CANCELLED');
  }

  return prisma.$transaction(async (tx) => {
    // If inputs were already registered, reverse the reservation
    if (run.inputs.length > 0 && run.status === 'IN_PROGRESS') {
      for (const input of run.inputs) {
        // Restore batch remaining KG — addToBatch creates a REVERSAL ledger entry
        await engine.addToBatch(tx, {
          batchId:       input.batchId,
          quantityKg:    input.quantityKg,
          movementType:  'REVERSAL',
          sourceRef:     { reversalOfId: input.id },   // links back to the input record
          performedById: userId,
          operationId:   `cancel:${id}:restore:${input.batchId}`,
          notes:         `Reversal — processing run ${run.runCode} cancelled`,
        });
      }
    }

    return tx.processingRun.update({
      where: { id },
      data:  { status: 'CANCELLED', version: { increment: 1 } },
    });
  }, { isolationLevel: 'Serializable', timeout: 30_000 });
}

module.exports = {
  createProcessingRun,
  listProcessingRuns,
  getProcessingRunById,
  addInputs,
  completeProcessing,
  cancelProcessingRun,
};
