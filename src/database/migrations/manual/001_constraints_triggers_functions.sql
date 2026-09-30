-- =============================================================================
-- CPIMS — Database Constraints, Triggers, and Functions
-- Applied AFTER Prisma initial migration
-- NOTE: Prisma generates camelCase column names in PostgreSQL — all column
--       references in raw SQL must use "camelCase" with double-quotes.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. BATCH INVARIANTS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE batches
  ADD CONSTRAINT chk_batch_remaining_kg_non_negative
  CHECK ("remainingKg" >= 0);

ALTER TABLE batches
  ADD CONSTRAINT chk_batch_original_kg_positive
  CHECK ("originalKg" > 0);

ALTER TABLE batches
  ADD CONSTRAINT chk_batch_remaining_lte_original
  CHECK ("remainingKg" <= "originalKg");

ALTER TABLE batches
  ADD CONSTRAINT chk_batch_cost_per_kg_non_negative
  CHECK ("costPerKg" >= 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. STOCK LEDGER IMMUTABILITY TRIGGER
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_prevent_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'IMMUTABLE_LEDGER: Stock ledger entries cannot be modified or deleted. '
    'Entry id=% is immutable after posting. Use a reversal entry instead.',
    OLD.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_stock_ledger_immutable_update
  BEFORE UPDATE ON stock_ledger
  FOR EACH ROW
  EXECUTE FUNCTION fn_prevent_ledger_mutation();

CREATE OR REPLACE TRIGGER trg_stock_ledger_immutable_delete
  BEFORE DELETE ON stock_ledger
  FOR EACH ROW
  EXECUTE FUNCTION fn_prevent_ledger_mutation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. STOCK LEDGER SOURCE INTEGRITY
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE stock_ledger
  ADD CONSTRAINT chk_ledger_exactly_one_source
  CHECK (
    num_nonnulls("purchaseId", "processingRunId", "saleId", "transferId", "adjustmentId", "reversalOfId") = 1
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PAYMENT SOURCE INTEGRITY
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payments
  ADD CONSTRAINT chk_payment_exactly_one_source
  CHECK (
    num_nonnulls("purchaseId", "saleId") = 1
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. PROCESSING LOSS GUARD
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE processing_runs
  ADD CONSTRAINT chk_processing_loss_kg_non_negative
  CHECK ("lossKg" IS NULL OR "lossKg" >= 0);

CREATE OR REPLACE FUNCTION fn_validate_processing_output()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."totalOutputKg" IS NOT NULL AND NEW."totalInputKg" IS NOT NULL THEN
    IF NEW."totalOutputKg" > NEW."totalInputKg" THEN
      RAISE EXCEPTION
        'PROCESSING_OUTPUT_EXCEEDS_INPUT: output_kg (%) cannot exceed input_kg (%). Processing run id=%.',
        NEW."totalOutputKg", NEW."totalInputKg", NEW.id;
    END IF;
    NEW."lossKg"  := NEW."totalInputKg" - NEW."totalOutputKg";
    NEW."lossPct" := CASE WHEN NEW."totalInputKg" > 0
                         THEN (NEW."lossKg" / NEW."totalInputKg") * 100
                         ELSE 0
                    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_processing_validate_output
  BEFORE INSERT OR UPDATE ON processing_runs
  FOR EACH ROW
  EXECUTE FUNCTION fn_validate_processing_output();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. LOCKED PERIOD GUARD
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_check_locked_period()
RETURNS TRIGGER AS $$
DECLARE
  v_locked_count INT;
BEGIN
  SELECT COUNT(*) INTO v_locked_count
  FROM locked_periods lp
  WHERE (lp."locationId" IS NULL OR lp."locationId" = NEW."locationId")
    AND NEW."postedAt"::date BETWEEN lp."periodStart" AND lp."periodEnd";

  IF v_locked_count > 0 THEN
    RAISE EXCEPTION
      'LOCKED_PERIOD: Cannot post a stock ledger entry dated % because that period is locked.',
      NEW."postedAt"::date;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_stock_ledger_locked_period
  BEFORE INSERT ON stock_ledger
  FOR EACH ROW
  EXECUTE FUNCTION fn_check_locked_period();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RECONCILIATION SESSION PERIOD OVERLAP GUARD
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_check_reconciliation_overlap()
RETURNS TRIGGER AS $$
DECLARE
  v_overlap_count INT;
BEGIN
  SELECT COUNT(*) INTO v_overlap_count
  FROM reconciliation_sessions rs
  WHERE rs.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND rs.status <> 'CLOSED'
    AND (rs."locationId" IS NULL OR rs."locationId" = NEW."locationId" OR NEW."locationId" IS NULL)
    AND (rs."periodStart", rs."periodEnd") OVERLAPS (NEW."periodStart", NEW."periodEnd");

  IF v_overlap_count > 0 THEN
    RAISE EXCEPTION
      'RECONCILIATION_OVERLAP: An open reconciliation session already exists that overlaps with period % to %.',
      NEW."periodStart", NEW."periodEnd";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_reconciliation_no_overlap
  BEFORE INSERT ON reconciliation_sessions
  FOR EACH ROW
  EXECUTE FUNCTION fn_check_reconciliation_overlap();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. SEQUENCE COUNTERS SEED
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO sequence_counters (name, "lastValue")
VALUES
  ('purchase',         0),
  ('sale',             0),
  ('processing_run',   0),
  ('payment',          0),
  ('adjustment',       0),
  ('transfer',         0),
  ('reconciliation',   0),
  ('batch',            0)
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. AUDIT LOG IMMUTABILITY
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_AUDIT_LOG: Audit log entries cannot be modified or deleted.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_audit_log_immutable_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION fn_prevent_audit_log_mutation();

CREATE OR REPLACE TRIGGER trg_audit_log_immutable_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION fn_prevent_audit_log_mutation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. PURCHASE ITEM CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE purchase_items
  ADD CONSTRAINT chk_purchase_item_qty_positive
  CHECK ("quantityKg" > 0);

ALTER TABLE purchase_items
  ADD CONSTRAINT chk_purchase_item_price_non_negative
  CHECK ("unitPriceKg" >= 0 AND "totalPrice" >= 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. SALE ITEM CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE sale_items
  ADD CONSTRAINT chk_sale_item_qty_positive
  CHECK ("quantityKg" > 0);

ALTER TABLE sale_items
  ADD CONSTRAINT chk_sale_item_price_non_negative
  CHECK ("unitSalePrice" >= 0 AND "saleAmount" >= 0 AND "costAmount" >= 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. PAYMENT CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payments
  ADD CONSTRAINT chk_payment_amount_positive
  CHECK (amount > 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. STOCK ADJUSTMENT CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE stock_adjustments
  ADD CONSTRAINT chk_stock_adjustment_qty_positive
  CHECK ("quantityKg" > 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. BATCH LINEAGE CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE batch_lineage
  ADD CONSTRAINT chk_batch_lineage_input_kg_positive
  CHECK ("inputKgUsed" > 0 AND "outputKgCredit" > 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. PROCESSING INPUT CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE processing_inputs
  ADD CONSTRAINT chk_processing_input_qty_positive
  CHECK ("quantityKg" > 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. OPTIMIZED REPORT INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ledger_batch_posted    ON stock_ledger ("batchId", "postedAt" DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_location_date   ON stock_ledger ("locationId", "postedAt" DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_movement_date   ON stock_ledger ("movementType", "postedAt" DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_agent_date    ON purchases ("agentId", "purchaseDate" DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_status_date   ON purchases (status, "purchaseDate" DESC);
CREATE INDEX IF NOT EXISTS idx_payment_due_status     ON payments ("dueDate", status);
CREATE INDEX IF NOT EXISTS idx_sync_ops_device_status ON sync_operations ("deviceId", status, "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_sync_conflict_status   ON sync_conflicts (status, "createdAt" DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 17. VIEWS FOR REPORTING
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW vw_batch_stock AS
SELECT
  b.id                AS batch_id,
  b."batchCode"       AS batch_code,
  b."coffeeTypeId"    AS coffee_type_id,
  ct.name             AS coffee_type_name,
  b."locationId"      AS location_id,
  l.name              AS location_name,
  b."originalKg"      AS original_kg,
  b."remainingKg"     AS remaining_kg,
  b."costPerKg"       AS cost_per_kg,
  b."totalCost"       AS total_cost,
  b.status,
  b.grade,
  COALESCE(SUM(sl."quantityKg"), 0) AS ledger_balance_kg
FROM batches b
JOIN coffee_types ct ON ct.id = b."coffeeTypeId"
JOIN locations    l  ON l.id  = b."locationId"
LEFT JOIN stock_ledger sl ON sl."batchId" = b.id
GROUP BY b.id, b."batchCode", b."coffeeTypeId", ct.name,
         b."locationId", l.name, b."originalKg", b."remainingKg",
         b."costPerKg", b."totalCost", b.status, b.grade;

CREATE OR REPLACE VIEW vw_location_stock AS
SELECT
  l.id   AS location_id,
  l.name AS location_name,
  ct.id  AS coffee_type_id,
  ct.name AS coffee_type_name,
  SUM(b."remainingKg") AS total_remaining_kg,
  SUM(b."totalCost")   AS total_cost_value
FROM batches b
JOIN locations    l  ON l.id  = b."locationId"
JOIN coffee_types ct ON ct.id = b."coffeeTypeId"
WHERE b.status IN ('ACTIVE', 'PARTIALLY_CONSUMED')
GROUP BY l.id, l.name, ct.id, ct.name;

CREATE OR REPLACE VIEW vw_purchase_payment_summary AS
SELECT
  p.id               AS purchase_id,
  p."purchaseNumber" AS purchase_number,
  p."agentId"        AS agent_id,
  COALESCE(SUM(pi."totalPrice"), 0) AS total_amount,
  COALESCE(SUM(pay.amount) FILTER (WHERE pay.status = 'COMPLETED'), 0) AS total_paid,
  COALESCE(SUM(pi."totalPrice"), 0)
    - COALESCE(SUM(pay.amount) FILTER (WHERE pay.status = 'COMPLETED'), 0) AS remaining_amount,
  p."creditDueDate"  AS credit_due_date
FROM purchases p
LEFT JOIN purchase_items pi  ON pi."purchaseId" = p.id
LEFT JOIN payments       pay ON pay."purchaseId" = p.id
GROUP BY p.id, p."purchaseNumber", p."agentId", p."creditDueDate";

CREATE OR REPLACE VIEW vw_sale_payment_summary AS
SELECT
  s.id             AS sale_id,
  s."saleNumber"   AS sale_number,
  s."agentId"      AS agent_id,
  COALESCE(s."totalSaleAmount", 0) AS total_amount,
  COALESCE(SUM(pay.amount) FILTER (WHERE pay.status = 'COMPLETED'), 0) AS total_received,
  COALESCE(s."totalSaleAmount", 0)
    - COALESCE(SUM(pay.amount) FILTER (WHERE pay.status = 'COMPLETED'), 0) AS remaining_amount,
  s."creditDueDate" AS credit_due_date
FROM sales s
LEFT JOIN payments pay ON pay."saleId" = s.id
GROUP BY s.id, s."saleNumber", s."agentId", s."totalSaleAmount", s."creditDueDate";
