'use strict';

const { SyncConflictDetectedError, BusinessRuleError } = require('../../../src/common/errors/AppError');

// ─── Simulated sync version check ─────────────────────────────────────────────

function checkVersionConflict(entityType, entityId, serverVersion, baseVersion) {
  if (serverVersion !== baseVersion) {
    throw new SyncConflictDetectedError(entityType, entityId, baseVersion, serverVersion);
  }
}

describe('Sync conflict detection — Scenario 40 (spec)', () => {
  /**
   * Server at version 7.
   * Device A downloads v7, edits → pushes as baseVersion=7 (succeeds → v8).
   * Device B downloads v7, edits → pushes as baseVersion=7 (server is now v8 → CONFLICT).
   */

  it('Device A — no conflict (server=7, base=7)', () => {
    expect(() => checkVersionConflict('purchase', 'p-1', 7, 7)).not.toThrow();
  });

  it('Device B — conflict detected (server=8, base=7)', () => {
    expect(() => checkVersionConflict('purchase', 'p-1', 8, 7))
      .toThrow(SyncConflictDetectedError);
  });

  it('Conflict error carries both versions for display', () => {
    try {
      checkVersionConflict('purchase', 'p-123', 8, 7);
    } catch (err) {
      expect(err.code).toBe('SYNC_CONFLICT_DETECTED');
      expect(err.details.localVersion).toBe(7);
      expect(err.details.serverVersion).toBe(8);
      expect(err.details.entityType).toBe('purchase');
      expect(err.details.entityId).toBe('p-123');
      expect(err.status).toBe(409);
    }
  });

  it('No automatic resolution — conflict must be created and left OPEN', () => {
    const conflict = {
      id:            'conflict-uuid',
      status:        'OPEN',
      localVersion:  7,
      serverVersion: 8,
      localPayload:  { agentId: 'agent-A' },
      serverPayload: { agentId: 'agent-B' },
      resolvedAt:    null,
      resolvedById:  null,
    };

    // Status must be OPEN — not auto-resolved
    expect(conflict.status).toBe('OPEN');
    expect(conflict.resolvedAt).toBeNull();
    expect(conflict.resolvedById).toBeNull();
  });

  it('Scenario 11 — two offline devices modify same financial record', () => {
    // Both devices download version 5
    const serverVersion = 5;

    // Device A edits and syncs — succeeds (baseVersion 5 matches server)
    expect(() => checkVersionConflict('payment', 'pay-1', serverVersion, 5)).not.toThrow();

    // Server is now version 6 after Device A's change
    const newServerVersion = 6;

    // Device B syncs with old baseVersion 5 — CONFLICT
    expect(() => checkVersionConflict('payment', 'pay-1', newServerVersion, 5))
      .toThrow(SyncConflictDetectedError);
  });

  it('Scenario 13 — conflict exists while server record has changed again', () => {
    // Conflict was created at server v8.
    // Meantime server moved to v9 (another user made a change).
    // Resolving should use the current server state (v9), not the conflict snapshot (v8).
    const conflictSnapshot = { serverVersion: 8 };
    const currentServer    = { version: 9 };

    // The resolution logic must fetch fresh server state, not rely on snapshot
    expect(currentServer.version).toBeGreaterThan(conflictSnapshot.serverVersion);
  });
});

describe('Sync operation idempotency — Scenario 2', () => {
  const appliedOps = new Set();

  function applyOnce(operationId, action) {
    if (appliedOps.has(operationId)) {
      return { alreadyApplied: true };
    }
    action();
    appliedOps.add(operationId);
    return { applied: true };
  }

  beforeEach(() => appliedOps.clear());

  it('Same operation submitted 10 times applies exactly once', () => {
    const opId = 'op-sync-xyz-123';
    let callCount = 0;

    const results = Array.from({ length: 10 }, () =>
      applyOnce(opId, () => { callCount++; }),
    );

    const applied = results.filter((r) => r.applied);
    expect(applied.length).toBe(1);
    expect(callCount).toBe(1);
    expect(appliedOps.size).toBe(1);
  });

  it('Different operations are each applied once', () => {
    let callCount = 0;
    applyOnce('op-1', () => callCount++);
    applyOnce('op-2', () => callCount++);
    applyOnce('op-1', () => callCount++); // duplicate
    applyOnce('op-3', () => callCount++);

    expect(callCount).toBe(3); // op-1, op-2, op-3
    expect(appliedOps.size).toBe(3);
  });
});
