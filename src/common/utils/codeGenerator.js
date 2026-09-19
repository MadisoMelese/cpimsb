'use strict';

/**
 * Generates human-readable document codes like PUR-000123.
 *
 * Atomically increments the named counter and returns the new value.
 * Safe under concurrent requests — the UPDATE is atomic in PostgreSQL.
 *
 * Note: Prisma created the column as "lastValue" (camelCase) not "last_value".
 */
async function nextCode(prisma, sequenceName, prefix, padLength = 6) {
  // Ensure the row exists (idempotent — won't reset an existing counter)
  await prisma.sequenceCounter.upsert({
    where:  { name: sequenceName },
    update: {},
    create: { name: sequenceName, lastValue: 0 },
  });

  // Atomic increment using the actual column name Prisma generated
  const result = await prisma.$queryRaw`
    UPDATE sequence_counters
    SET    "lastValue" = "lastValue" + 1
    WHERE  name = ${sequenceName}
    RETURNING "lastValue" AS next_val
  `;

  const nextVal = Number(result[0].next_val);
  const padded  = String(nextVal).padStart(padLength, '0');
  return `${prefix}-${padded}`;
}

module.exports = { nextCode };
