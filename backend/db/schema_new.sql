CREATE TABLE stores (
  id   TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
, is_active INTEGER NOT NULL DEFAULT 1);

CREATE TABLE store_vendor_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id    TEXT NOT NULL,
  vendor_id   TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  valid_from  DATE NOT NULL,
  valid_to    DATE,
  UNIQUE (store_id, vendor_id, item_id, valid_from)
);

CREATE TABLE store_vendor_overrides (
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

  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  PRIMARY KEY (store_id, vendor_id)
);

CREATE TABLE vendors (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE vendor_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id   TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  valid_from  DATE NOT NULL,      -- 'YYYY-MM-DD'
  valid_to    DATE,               -- NULL=当面有効
  UNIQUE (vendor_id, item_id, valid_from)
);

CREATE TABLE vendor_weekly_rules (
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

  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE items (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  unit          TEXT NOT NULL,
  spec          TEXT,
  temp_zone     TEXT CHECK (temp_zone IN ('ambient','chilled','frozen')) NOT NULL DEFAULT 'ambient',
  is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE item_prices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id    TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  unit_price   REAL NOT NULL,
  valid_from   TEXT NOT NULL,      -- YYYY-MM-DD
  valid_to     TEXT,               -- NULL=現行
  UNIQUE(vendor_id, item_id, valid_from)
);

CREATE TABLE orders (
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  expected_arrival_date TEXT, vendor_id TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE "shipments" (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id        TEXT NOT NULL,
  destination_id   TEXT NOT NULL,
  destination_name TEXT,
  delivery_date    TEXT NOT NULL, -- 'YYYY-MM-DD'
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','confirmed','canceled')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

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
LEFT JOIN stores  st ON st.id = s.destination_id

CREATE VIEW v_shipment_lines AS
SELECT
  sl.*,
  i.name AS item_name
FROM shipment_lines sl
LEFT JOIN items i ON i.id = sl.item_id

