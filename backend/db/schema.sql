-- backend/db/schema.sql（統合・修正版案）

PRAGMA foreign_keys = ON;

-- items: 品目マスタ
CREATE TABLE IF NOT EXISTS items (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  unit          TEXT NOT NULL,
  spec          TEXT,
  temp_zone     TEXT CHECK (temp_zone IN ('ambient','chilled','frozen')) NOT NULL DEFAULT 'ambient',
  is_active     INTEGER NOT NULL DEFAULT 1,
  stock_unit    TEXT, 
  stock_conv    REAL NOT NULL DEFAULT 1
);

-- 価格（ベンダー×品目×期間）
CREATE TABLE IF NOT EXISTS item_prices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id    TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  unit_price   REAL NOT NULL,
  valid_from   TEXT NOT NULL,      -- YYYY-MM-DD
  valid_to     TEXT,               -- NULL=現行
  UNIQUE(vendor_id, item_id, valid_from)
);

-- ベンダーの週間ルール（曜日ごと）
CREATE TABLE IF NOT EXISTS vendor_weekly_rules (
  vendor_id TEXT PRIMARY KEY,

  -- 日曜
  orderable_sun        INTEGER NOT NULL DEFAULT 0,  -- 1=発注可,0=不可
  cutoff_hhmm_sun      TEXT    NOT NULL DEFAULT '04:00', -- "HH:MM"
  lead_time_days_sun   INTEGER NOT NULL DEFAULT 1,

  -- 月曜
  orderable_mon        INTEGER NOT NULL DEFAULT 0,
  cutoff_hhmm_mon      TEXT    NOT NULL DEFAULT '04:00',
  lead_time_days_mon   INTEGER NOT NULL DEFAULT 1,

  -- 火曜
  orderable_tue        INTEGER NOT NULL DEFAULT 0,
  cutoff_hhmm_tue      TEXT    NOT NULL DEFAULT '04:00',
  lead_time_days_tue   INTEGER NOT NULL DEFAULT 1,

  -- 水曜
  orderable_wed        INTEGER NOT NULL DEFAULT 0,
  cutoff_hhmm_wed      TEXT    NOT NULL DEFAULT '04:00',
  lead_time_days_wed   INTEGER NOT NULL DEFAULT 1,

  -- 木曜
  orderable_thu        INTEGER NOT NULL DEFAULT 0,
  cutoff_hhmm_thu      TEXT    NOT NULL DEFAULT '04:00',
  lead_time_days_thu   INTEGER NOT NULL DEFAULT 1,

  -- 金曜
  orderable_fri        INTEGER NOT NULL DEFAULT 0,
  cutoff_hhmm_fri      TEXT    NOT NULL DEFAULT '04:00',
  lead_time_days_fri   INTEGER NOT NULL DEFAULT 1,

  -- 土曜
  orderable_sat        INTEGER NOT NULL DEFAULT 0,
  cutoff_hhmm_sat      TEXT    NOT NULL DEFAULT '04:00',
  lead_time_days_sat   INTEGER NOT NULL DEFAULT 1,

  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 店舗×ベンダーの上書き
CREATE TABLE IF NOT EXISTS store_vendor_overrides (
  store_id  TEXT NOT NULL,
  vendor_id TEXT NOT NULL,

  -- 日曜
  orderable_sun_override        INTEGER,
  cutoff_hhmm_sun_override      TEXT,
  lead_time_days_sun_override   INTEGER,

  -- 月曜
  orderable_mon_override        INTEGER,
  cutoff_hhmm_mon_override      TEXT,
  lead_time_days_mon_override   INTEGER,

  -- 火曜
  orderable_tue_override        INTEGER,
  cutoff_hhmm_tue_override      TEXT,
  lead_time_days_tue_override   INTEGER,

  -- 水曜
  orderable_wed_override        INTEGER,
  cutoff_hhmm_wed_override      TEXT,
  lead_time_days_wed_override   INTEGER,

  -- 木曜
  orderable_thu_override        INTEGER,
  cutoff_hhmm_thu_override      TEXT,
  lead_time_days_thu_override   INTEGER,

  -- 金曜
  orderable_fri_override        INTEGER,
  cutoff_hhmm_fri_override      TEXT,
  lead_time_days_fri_override   INTEGER,

  -- 土曜
  orderable_sat_override        INTEGER,
  cutoff_hhmm_sat_override      TEXT,
  lead_time_days_sat_override   INTEGER,

  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),

  PRIMARY KEY (store_id, vendor_id)
);

-- stores: 店舗マスタ
CREATE TABLE IF NOT EXISTS stores (
  id        TEXT PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

-- vendors: ベンダーマスタ
CREATE TABLE IF NOT EXISTS vendors (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

-- 受注ヘッダ
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  vendor_id TEXT,
  vendor_mode TEXT NOT NULL,
  order_date TEXT NOT NULL,
  expected_arrival_date TEXT,
  subtotal INTEGER NOT NULL,
  tax INTEGER NOT NULL,
  total INTEGER NOT NULL,
  tax_rate REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 受注明細
CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  expected_arrival_date TEXT,
  vendor_id TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

-- 出荷ヘッダ
CREATE TABLE IF NOT EXISTS shipments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id        TEXT NOT NULL,
  destination_id   TEXT NOT NULL,
  destination_name TEXT,
  delivery_date    TEXT NOT NULL, -- 'YYYY-MM-DD'
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','confirmed','canceled')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')), 
  order_date       TEXT
);

-- 出荷明細
CREATE TABLE IF NOT EXISTS shipment_lines (
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

-- 1) ベンダー×品目（期間管理）
CREATE TABLE IF NOT EXISTS vendor_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id   TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  valid_from  DATE NOT NULL,      -- 'YYYY-MM-DD'
  valid_to    DATE,               -- NULL=当面有効
  UNIQUE (vendor_id, item_id, valid_from)
);

CREATE INDEX IF NOT EXISTS ix_vendor_items_range
  ON vendor_items (vendor_id, item_id, valid_from, COALESCE(valid_to,'9999-12-31'));

-- 2) 店舗×ベンダー×品目（期間管理）
CREATE TABLE IF NOT EXISTS store_vendor_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id    TEXT NOT NULL,
  vendor_id   TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  valid_from  DATE NOT NULL,
  valid_to    DATE,
  UNIQUE (store_id, vendor_id, item_id, valid_from)
);

CREATE INDEX IF NOT EXISTS ix_store_vendor_items_range
  ON store_vendor_items (store_id, vendor_id, item_id, valid_from, COALESCE(valid_to,'9999-12-31'));

-- ★ユニーク制約（重複生成を物理的に防ぐ）

-- 同一（店舗, モード, ベンダ, 発注日）は一意
CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_business
  ON orders(store_id, vendor_mode, vendor_id, order_date);

-- 出荷ヘッダ：ベンダー×納品先×納品日で一意
DROP INDEX IF EXISTS ux_shipments_store_vendor_date;
CREATE UNIQUE INDEX IF NOT EXISTS ux_shipments_vendor_dest_date
  ON shipments(vendor_id, destination_id, delivery_date);

-- 出荷明細：1伝票内で品目重複なし
CREATE UNIQUE INDEX IF NOT EXISTS ux_shipment_lines_header_item
  ON shipment_lines(shipment_id, item_id);

-- ID 形式チェック用トリガー

-- items.id は 6桁数字のみ
CREATE TRIGGER IF NOT EXISTS trg_items_id_len
BEFORE INSERT ON items
FOR EACH ROW
WHEN length(NEW.id) <> 6 OR NEW.id GLOB '*[^0-9]*'
BEGIN
  SELECT RAISE(ABORT, 'items.id must be 6-digit numeric');
END;

-- vendors.id は 6桁数字のみ
CREATE TRIGGER IF NOT EXISTS trg_vendors_id_len
BEFORE INSERT ON vendors
FOR EACH ROW
WHEN length(NEW.id) <> 6 OR NEW.id GLOB '*[^0-9]*'
BEGIN
  SELECT RAISE(ABORT, 'vendors.id must be 6-digit numeric');
END;

-- stores.id は 4桁数字のみ
CREATE TRIGGER IF NOT EXISTS trg_stores_id_len
BEFORE INSERT ON stores
FOR EACH ROW
WHEN length(NEW.id) <> 4 OR NEW.id GLOB '*[^0-9]*'
BEGIN
  SELECT RAISE(ABORT, 'stores.id must be 4-digit numeric');
END;

-- 出荷系 VIEW（一覧用）

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

-- 検品ヘッダ
CREATE TABLE IF NOT EXISTS inspections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id  INTEGER NOT NULL UNIQUE,   -- 対象となる出荷伝票
  owner_id     CHAR(4) NOT NULL,          -- 検品主体（当面は店舗ID＝destination_id）
  delivery_date TEXT,                     -- 納品日 YYYY-MM-DD
  status       TEXT NOT NULL DEFAULT 'open',  -- open / completed / audited など今後拡張
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (shipment_id) REFERENCES shipments(id)
);


-- 検品明細
CREATE TABLE inspection_lines (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id  INTEGER NOT NULL,
  item_id        CHAR(6) NOT NULL,
  ship_qty       REAL NOT NULL DEFAULT 0,  -- 出荷数量（参照用）
  inspected_qty  REAL NOT NULL DEFAULT 0,  -- 検品数量（編集対象）
  diff_qty       REAL NOT NULL DEFAULT 0,  -- inspected_qty - ship_qty
  unit           TEXT,
  spec           TEXT,
  temp_zone      TEXT,
  lot_no         TEXT,
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')), 
  unit_price     REAL NOT NULL DEFAULT 0, 
  amount         REAL NOT NULL DEFAULT 0,
  UNIQUE(inspection_id, item_id),
  FOREIGN KEY (inspection_id) REFERENCES inspections(id)
);

CREATE TABLE store_shipments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_no      TEXT,            -- 将来のための伝票番号（"STS-000001" など）
  from_store_id    CHAR(4) NOT NULL, -- 出荷元店舗
  to_store_id      CHAR(4),          -- 店間移動なら相手店舗、廃棄なら NULL
  movement_type    TEXT NOT NULL,    -- 'TRANSFER' | 'DISPOSAL'
  shipment_date    TEXT NOT NULL,    -- 営業日付ベース "YYYY-MM-DD"
  status           TEXT NOT NULL,    -- 'draft' | 'confirmed'
  memo             TEXT,
  created_at       TEXT NOT NULL,
  created_by       TEXT,
  updated_at       TEXT NOT NULL,
  updated_by       TEXT
);

CREATE TABLE store_shipment_lines (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  header_id      INTEGER NOT NULL REFERENCES store_shipments(id) ON DELETE CASCADE,
  line_no        INTEGER NOT NULL,
  item_id        CHAR(6) NOT NULL,
  qty            REAL NOT NULL,
  unit           TEXT,
  memo           TEXT,
  unit_cost      REAL NOT NULL DEFAULT 0, 
  amount         REAL NOT NULL DEFAULT 0
);

-- 店舗在庫の入出庫履歴
CREATE TABLE store_stock_movements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id       CHAR(4) NOT NULL,   -- 店舗ID（検品の owner_id / destination_id と対応）
  item_id        CHAR(6) NOT NULL,   -- 品目ID
  movement_date  TEXT NOT NULL,      -- "YYYY-MM-DD"（営業日ベース）
  movement_type  TEXT NOT NULL,      -- 'RECEIPT' | 'SHIPMENT' | 'ADJUSTMENT' | 'COUNT'
  qty            REAL NOT NULL,      -- 増減数量（受入なら＋、出荷なら− でもOKだが、まずは正数＋種別で運用でも可）
  ref_type       TEXT,               -- 'inspection' | 'store_shipment' | 'stock_count' など
  ref_id         INTEGER,            -- 紐づく inspections.id / store_shipments.id など
  memo           TEXT,
  created_at     TEXT NOT NULL,
  created_by     TEXT,
  updated_at     TEXT NOT NULL,
  updated_by     TEXT,
  unit_cost      REAL, 
  amount         REAL
);

CREATE TABLE IF NOT EXISTS stock_valuation_settings (
  store_id   TEXT PRIMARY KEY,
  method     TEXT NOT NULL CHECK (method IN ('TOTAL_AVG', 'MOVING_AVG')),
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_store_stock_movements_store_item_date
  ON store_stock_movements (store_id, item_id, movement_date);

CREATE INDEX IF NOT EXISTS idx_store_stock_movements_ref
  ON store_stock_movements (ref_type, ref_id);


-- インデックス・トリガー類
-- CREATE UNIQUE INDEX IF NOT EXISTS ux_shipment_lines_header_item
--   ON shipment_lines(shipment_id, item_id);
-- -- 同一（店舗, モード, ベンダ, 発注日）は一意
-- CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_business
-- ON orders(store_id, vendor_mode, vendor_id, order_date);
-- CREATE INDEX IF NOT EXISTS ix_vendor_items_range
--   ON vendor_items (vendor_id, item_id, valid_from, COALESCE(valid_to,'9999-12-31'));
-- CREATE INDEX IF NOT EXISTS ix_store_vendor_items_range
--   ON store_vendor_items (store_id, vendor_id, item_id, valid_from, COALESCE(valid_to,'9999-12-31'));

-- -- items.id は 6桁数字のみ
-- CREATE TRIGGER IF NOT EXISTS trg_items_id_len
-- BEFORE INSERT ON items
-- FOR EACH ROW
-- WHEN length(NEW.id) <> 6 OR NEW.id GLOB '*[^0-9]*'
-- BEGIN
--   SELECT RAISE(ABORT, 'items.id must be 6-digit numeric');
-- END;

-- -- vendors.id は 6桁数字のみ
-- CREATE TRIGGER IF NOT EXISTS trg_vendors_id_len
-- BEFORE INSERT ON vendors
-- FOR EACH ROW
-- WHEN length(NEW.id) <> 6 OR NEW.id GLOB '*[^0-9]*'
-- BEGIN
--   SELECT RAISE(ABORT, 'vendors.id must be 6-digit numeric');
-- END;

-- -- stores.id は 4桁数字のみ
-- CREATE TRIGGER IF NOT EXISTS trg_stores_id_len
-- BEFORE INSERT ON stores
-- FOR EACH ROW
-- WHEN length(NEW.id) <> 4 OR NEW.id GLOB '*[^0-9]*'
-- BEGIN
--   SELECT RAISE(ABORT, 'stores.id must be 4-digit numeric');
-- END;

