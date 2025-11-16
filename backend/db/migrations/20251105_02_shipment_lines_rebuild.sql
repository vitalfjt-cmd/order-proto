PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

/* shipment_lines テーブルを新規作成（旧構成は破棄） */
DROP TABLE IF EXISTS shipment_lines;

CREATE TABLE shipment_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id   INTEGER NOT NULL,
  item_id       TEXT NOT NULL,
  ordered_qty   INTEGER NOT NULL DEFAULT 0,   -- 受注数
  ship_qty      INTEGER NOT NULL DEFAULT 0,   -- 出荷数
  unit_price    INTEGER NOT NULL DEFAULT 0,
  amount        INTEGER NOT NULL DEFAULT 0,   -- ship_qty * unit_price
  unit          TEXT,
  spec          TEXT,
  temp_zone     TEXT CHECK (temp_zone IN ('ambient','chilled','frozen')),
  lot_no        TEXT,
  note          TEXT,
  FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_shipment_lines_header_item
  ON shipment_lines (shipment_id, item_id);

COMMIT;
PRAGMA foreign_keys = ON;
