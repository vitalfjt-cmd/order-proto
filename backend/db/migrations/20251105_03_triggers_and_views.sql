PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

/* ========== amount 自動維持トリガ ========== */
DROP TRIGGER IF EXISTS trg_shipment_lines_amount_ai;
DROP TRIGGER IF EXISTS trg_shipment_lines_amount_au;

CREATE TRIGGER trg_shipment_lines_amount_ai
AFTER INSERT ON shipment_lines
BEGIN
  UPDATE shipment_lines
     SET amount = COALESCE(ship_qty,0) * COALESCE(unit_price,0)
   WHERE id = NEW.id;
END;

CREATE TRIGGER trg_shipment_lines_amount_au
AFTER UPDATE OF ship_qty, unit_price ON shipment_lines
BEGIN
  UPDATE shipment_lines
     SET amount = COALESCE(ship_qty,0) * COALESCE(unit_price,0)
   WHERE id = NEW.id;
END;

/* ========== 名称ビュー ========== */
DROP VIEW IF EXISTS v_shipments;
CREATE VIEW v_shipments AS
SELECT
  s.id,
  s.delivery_date,
  s.status,
  s.vendor_id,
  v.name  AS vendor_name,
  s.destination_id,
  COALESCE(s.destination_name, st.name) AS destination_name,
  s.created_at,
  s.updated_at
FROM shipments s
LEFT JOIN vendors v ON v.id = s.vendor_id
LEFT JOIN stores  st ON st.id = s.destination_id;

DROP VIEW IF EXISTS v_shipment_lines;
CREATE VIEW v_shipment_lines AS
SELECT
  sl.*,
  i.name AS item_name
FROM shipment_lines sl
LEFT JOIN items i ON i.id = sl.item_id;

COMMIT;
