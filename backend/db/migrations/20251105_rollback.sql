PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

/* ビュー/トリガ除去 */
DROP VIEW IF EXISTS v_shipment_lines;
DROP VIEW IF EXISTS v_shipments;
DROP TRIGGER IF EXISTS trg_shipment_lines_amount_au;
DROP TRIGGER IF EXISTS trg_shipment_lines_amount_ai;

/* shipment_lines を旧構成に戻す（qtyへ集約） */
CREATE TABLE IF NOT EXISTS shipment_lines_old (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id   INTEGER NOT NULL,
  item_id       TEXT NOT NULL,
  qty           INTEGER NOT NULL DEFAULT 0,
  unit_price    INTEGER NOT NULL DEFAULT 0,
  amount        INTEGER NOT NULL DEFAULT 0,
  unit          TEXT,
  spec          TEXT,
  temp_zone     TEXT,
  lot_no        TEXT,
  note          TEXT
);
INSERT INTO shipment_lines_old (id, shipment_id, item_id, qty, unit_price, amount, unit, spec, temp_zone, lot_no, note)
SELECT id, shipment_id, item_id, COALESCE(ship_qty,0), unit_price, amount, unit, spec, temp_zone, lot_no, note
FROM shipment_lines;
DROP TABLE shipment_lines;
ALTER TABLE shipment_lines_old RENAME TO shipment_lines;
CREATE UNIQUE INDEX IF NOT EXISTS ux_shipment_lines_header_item
  ON shipment_lines (shipment_id, item_id);

/* shipments を旧構成に戻す（store_idへ戻す） */
CREATE TABLE IF NOT EXISTS shipments_old (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id     TEXT NOT NULL,
  store_id      TEXT NOT NULL,
  delivery_date TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
INSERT INTO shipments_old (id, vendor_id, store_id, delivery_date, created_at, updated_at)
SELECT id, vendor_id, COALESCE(destination_id, '0000'), delivery_date, created_at, updated_at
FROM shipments;
DROP TABLE shipments;
ALTER TABLE shipments_old RENAME TO shipments;
CREATE UNIQUE INDEX IF NOT EXISTS ux_shipments_store_vendor_date
  ON shipments (vendor_id, store_id, delivery_date);

COMMIT;
PRAGMA foreign_keys = ON;
