-- =============================================================================
-- CPIMS — Database Constraints, Triggers, and Functions
-- Applied AFTER Prisma initial migration
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. BATCH INVARIANTS
-- ─────────────────────────────────────────────────────────────────────────────

-- Prevent negative remaining KG at the database level
ALTER TABLE batches
  ADD CONSTRAINT chk_batch_remaining_kg_non_negative
  CHECK (remaining_kg >= 0);

-- Prevent original KG being zero or negative
ALTER TABLE batches
  ADD CONSTRAINT chk_batch_original_kg_positive
  CHECK (original_kg > 0);

-- Remaining KG cannot exceed original KG
ALTER TABLE batches
  ADD CONSTRAINT chk_batch_remaining_lte_original
  CHECK (remaining_kg <= original_kg);

-- Cost per KG must be non-negative
ALTER TABLE batches
  ADD CONSTRAINT chk_batch_cost_per_kg_non_negative
  CHECK (cost_per_kg >= 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. STOCK LEDGER IMMUTABILITY TRIGGER
-- A posted stock ledger row must NEVER be updated or deleted.
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

CREATE TRIGGER trg_stock_ledger_immutable_update
  BEFORE UPDATE ON stock_ledger
  FOR EACH ROW
  EXECUTE FUNCTION fn_prevent_ledger_mutation();

CREATE TRIGGER trg_stock_ledger_immutable_delete
  BEFORE DELETE ON stock_ledger
  FOR EACH ROW
  EXECUTE FUNCTION fn_prevent_ledger_mutation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. STOCK LEDGER SOURCE INTEGRITY
-- Exactly one source reference must be non-null.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE stock_ledger
  ADD CONSTRAINT chk_ledger_exactly_one_source
  CHECK (
    num_nonnulls(purchase_id, processing_run_id, sale_id, transfer_id, adjustment_id, reversal_of_id) = 1
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PAYMENT SOURCE INTEGRITY
-- A payment must reference exactly one of: purchase or sale
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE payments
  ADD CONSTRAINT chk_payment_exactly_one_source
  CHECK (
    num_nonnulls(purchase_id, sale_id) = 1
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. PROCESSING LOSS GUARD
-- Output KG cannot exceed input KG (enforced via trigger on completion)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE processing_runs
  ADD CONSTRAINT chk_processing_loss_kg_non_negative
  CHECK (loss_kg IS NULL OR loss_kg >= 0);

-- Function enforces output <= input when completing a processing run
CREATE OR REPLACE FUNCTION fn_validate_processing_output()
RETURNS TRIGGER AS $$
BEGIN
  -- Only validate when total_output_kg and total_input_kg are both set
  IF NEW.total_output_kg IS NOT NULL AND NEW.total_input_kg IS NOT NULL THEN
    IF NEW.total_output_kg > NEW.total_input_kg THEN
      RAISE EXCEPTION
        'PROCESSING_OUTPUT_EXCEEDS_INPUT: output_kg (%) cannot exceed input_kg (%). '
        'Processing run id=%.',
        NEW.total_output_kg, NEW.total_input_kg, NEW.id;
    END IF;
    -- Compute loss
    NEW.loss_kg  := NEW.total_input_kg - NEW.total_output_kg;
    NEW.loss_pct := CASE WHEN NEW.total_input_kg > 0
                         THEN (NEW.loss_kg / NEW.total_input_kg) * 100
                         ELSE 0
                    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_processing_validate_output
  BEFORE INSERT OR UPDATE ON processing_runs
  FOR EACH ROW
  EXECUTE FUNCTION fn_validate_processing_output();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. LOCKED PERIOD GUARD
-- Stock ledger entries cannot be backdated into a closed reconciliation period.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_check_locked_period()
RETURNS TRIGGER AS $$
DECLARE
  v_locked_count INT;
BEGIN
  SELECT COUNT(*) INTO v_locked_count
  FROM locked_periods lp
  WHERE (lp.location_id IS NULL OR lp.location_id = NEW.location_id)
    AND NEW.posted_at::date BETWEEN lp.period_start AND lp.period_end;

  IF v_locked_count > 0 THEN
    RAISE EXCEPTION
      'LOCKED_PERIOD: Cannot post a stock ledger entry dated % '
      'because that period is locked by a closed reconciliation session.',
      NEW.posted_at::date;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_ledger_locked_period
  BEFORE INSERT ON stock_ledger
  FOR EACH ROW
  EXECUTE FUNCTION fn_check_locked_period();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RECONCILIATION SESSION PERIOD OVERLAP GUARD
-- Two open reconciliation sessions for the same location cannot have
-- overlapping periods.
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
    AND (rs.location_id IS NULL OR rs.location_id = NEW.location_id OR NEW.location_id IS NULL)
    AND (rs.period_start, rs.period_end) OVERLAPS (NEW.period_start, NEW.period_end);

  IF v_overlap_count > 0 THEN
    RAISE EXCEPTION
      'RECONCILIATION_OVERLAP: An open reconciliation session already exists '
      'that overlaps with period % to %.',
      NEW.period_start, NEW.period_end;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reconciliation_no_overlap
  BEFORE INSERT ON reconciliation_sessions
  FOR EACH ROW
  EXECUTE FUNCTION fn_check_reconciliation_overlap();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. HUMAN-READABLE SEQUENCE FUNCTION
-- Returns next value for a named sequence (thread-safe via advisory lock)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO sequence_counters (name, last_value)
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

CREATE OR REPLACE FUNCTION fn_next_sequence(p_name TEXT)
RETURNS INT AS $$
DECLARE
  v_next INT;
BEGIN
  UPDATE sequence_counters
  SET last_value = last_value + 1
  WHERE name = p_name
  RETURNING last_value INTO v_next;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_SEQUENCE: No sequence named %', p_name;
  END IF;

  RETURN v_next;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. AUDIT LOG IMMUTABILITY
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'IMMUTABLE_AUDIT_LOG: Audit log entries cannot be modified or deleted.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_immutable_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION fn_prevent_audit_log_mutation();

CREATE TRIGGER trg_audit_log_immutable_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION fn_prevent_audit_log_mutation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. PURCHASE ITEM CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE purchase_items
  ADD CONSTRAINT chk_purchase_item_qty_positive
  CHECK (quantity_kg > 0);

ALTER TABLE purchase_items
  ADD CONSTRAINT chk_purchase_item_price_non_negative
  CHECK (unit_price_kg >= 0 AND total_price >= 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. SALE ITEM CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE sale_items
  ADD CONSTRAINT chk_sale_item_qty_positive
  CHECK (quantity_kg > 0);

ALTER TABLE sale_items
  ADD CONSTRAINT chk_sale_item_price_non_negative
  CHECK (unit_sale_price >= 0 AND sale_amount >= 0 AND cost_amount >= 0);

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
  CHECK (quantity_kg > 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. BATCH LINEAGE CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE batch_lineage
  ADD CONSTRAINT chk_batch_lineage_input_kg_positive
  CHECK (input_kg_used > 0 AND output_kg_credit > 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. PROCESSING INPUT CONSTRAINTS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE processing_inputs
  ADD CONSTRAINT chk_processing_input_qty_positive
  CHECK (quantity_kg > 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. OPTIMIZED REPORT INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

-- Ledger aggregation by date range (common in reports)
CREATE INDEX idx_ledger_batch_posted  ON stock_ledger (batch_id, posted_at DESC);
CREATE INDEX idx_ledger_location_date ON stock_ledger (location_id, posted_at DESC);
CREATE INDEX idx_ledger_movement_date ON stock_ledger (movement_type, posted_at DESC);

-- Purchase reports
CREATE INDEX idx_purchase_agent_date  ON purchases (agent_id, purchase_date DESC);
CREATE INDEX idx_purchase_status_date ON purchases (status, purchase_date DESC);

-- Payment due date lookups
CREATE INDEX idx_payment_due_status   ON payments (due_date, status);

-- Sync diagnostics
CREATE INDEX idx_sync_ops_device_status ON sync_operations (device_id, status, created_at DESC);
CREATE INDEX idx_sync_conflict_status   ON sync_conflicts (status, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 17. ENFORCE PURCHASE APPROVAL IDEMPOTENCY AT DB LEVEL
-- The approval_operation_id unique constraint on purchases table prevents
-- a double-approval from two concurrent requests. This is in schema.prisma
-- but we document it here for clarity.
-- ─────────────────────────────────────────────────────────────────────────────

-- Already enforced by UNIQUE constraint on purchases.approval_operation_id
-- and purchases.status = 'APPROVED' can only be set once.

-- ─────────────────────────────────────────────────────────────────────────────
-- 18. VIEWS FOR REPORTING (derived from authoritative ledger)
-- ─────────────────────────────────────────────────────────────────────────────

-- Current batch stock positions derived entirely from the ledger
CREATE OR REPLACE VIEW vw_batch_stock AS
SELECT
  b.id                                                    AS batch_id,
  b.batch_code,
  b.coffee_type_id,
  ct.name                                                 AS coffee_type_name,
  b.location_id,
  l.name                                                  AS location_name,
  b.original_kg,
  b.remaining_kg,
  b.cost_per_kg,
  b.total_cost,
  b.status,
  COALESCE(SUM(sl.quantity_kg), 0)                        AS ledger_balance_kg
FROM batches b
JOIN coffee_types ct ON ct.id = b.coffee_type_id
JOIN locations   l  ON l.id  = b.location_id
LEFT JOIN stock_ledger sl ON sl.batch_id = b.id
GROUP BY b.id, b.batch_code, b.coffee_type_id, ct.name,
         b.location_id, l.name, b.original_kg, b.remaining_kg,
         b.cost_per_kg, b.total_cost, b.status;

-- Location-level stock summary (aggregated from batch balances)
CREATE OR REPLACE VIEW vw_location_stock AS
SELECT
  l.id             AS location_id,
  l.name           AS location_name,
  ct.id            AS coffee_type_id,
  ct.name          AS coffee_type_name,
  SUM(b.remaining_kg) AS total_remaining_kg,
  SUM(b.total_cost)   AS total_cost_value
FROM batches b
JOIN locations   l  ON l.id  = b.location_id
JOIN coffee_types ct ON ct.id = b.coffee_type_id
WHERE b.status IN ('ACTIVE', 'PARTIALLY_CONSUMED')
GROUP BY l.id, l.name, ct.id, ct.name;

-- Purchase payment summary (AR/AP totals)
CREATE OR REPLACE VIEW vw_purchase_payment_summary AS
SELECT
  p.id                AS purchase_id,
  p.purchase_number,
  p.agent_id,
  COALESCE(SUM(pi.total_price), 0)                                   AS total_amount,
  COALESCE(SUM(pay.amount) FILTER (WHERE pay.status = 'COMPLETED'), 0) AS total_paid,
  COALESCE(SUM(pi.total_price), 0)
    - COALESCE(SUM(pay.amount) FILTER (WHERE pay.status = 'COMPLETED'), 0) AS remaining_amount,
  p.credit_due_date
FROM purchases p
LEFT JOIN purchase_items pi  ON pi.purchase_id = p.id
LEFT JOIN payments       pay ON pay.purchase_id = p.id
GROUP BY p.id, p.purchase_number, p.agent_id, p.credit_due_date;

-- Sale payment summary
CREATE OR REPLACE VIEW vw_sale_payment_summary AS
SELECT
  s.id             AS sale_id,
  s.sale_number,
  s.agent_id,
  COALESCE(s.total_sale_amount, 0)                                    AS total_amount,
  COALESCE(SUM(pay.amount) FILTER (WHERE pay.status = 'COMPLETED'), 0) AS total_received,
  COALESCE(s.total_sale_amount, 0)
    - COALESCE(SUM(pay.amount) FILTER (WHERE pay.status = 'COMPLETED'), 0) AS remaining_amount,
  s.credit_due_date
FROM sales s
LEFT JOIN payments pay ON pay.sale_id = s.id
GROUP BY s.id, s.sale_number, s.agent_id, s.total_sale_amount, s.credit_due_date;
