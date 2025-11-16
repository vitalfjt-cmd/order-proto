-- items
INSERT INTO items (id, name, unit, spec, temp_zone, is_active) VALUES
('000001','鶏もも肉','c/s','2kg','chilled',1),
('000002','冷凍枝豆','c/s','1kg','frozen',1),
('000003','カット野菜','c/s','500g','chilled',1);

-- item_prices
INSERT INTO item_prices (vendor_id, item_id, unit_price, valid_from, valid_to) VALUES
('000001','000001',101,'2025-01-01',NULL),
('000001','000002',140,'2025-01-01',NULL),
('000001','000003',120,'2025-01-01',NULL);

-- vendor_weekly_rules
INSERT INTO vendor_weekly_rules (vendor_id, weekday, orderable, cutoff_hhmm, lead_time_days) VALUES
('000001',0,0,'04:00',1),
('000001',1,1,'04:00',1), -- ... 略

-- store_vendor_overrides
INSERT INTO store_vendor_overrides (store_id, vendor_id, weekday, orderable, cutoff_hhmm, lead_time_days) VALUES
('0001','000001',2,1,'03:00',1);

-- stores
INSERT OR IGNORE INTO stores (id, code, name) VALUES
('0001','0001','渋谷店'),('0002','0002','新宿店'),('0003','0003','池袋店');

-- vendors
INSERT OR IGNORE INTO vendors (id, name) VALUES
('000001','中央物流センター'),('000002','青果ベンダー'),('000003','精肉ベンダー');

-- 共通品目（item '000001' を全ベンダーで扱う）
INSERT OR IGNORE INTO vendor_items (vendor_id, item_id, valid_from, valid_to) VALUES
('000001','000001','2025-01-01',NULL),
('000002','000001','2025-01-01',NULL),
('000003','000001','2025-01-01',NULL);

-- 固有品目
INSERT OR IGNORE INTO vendor_items (vendor_id, item_id, valid_from, valid_to) VALUES
('000001','000002','2025-01-01',NULL),
('000002','000003','2025-01-01',NULL),
('000003','000004','2025-01-01',NULL);

-- 店舗0001: ベンダー1(共通+固有000002), ベンダー2(共通), ベンダー3(共通)
INSERT OR IGNORE INTO store_vendor_items (store_id, vendor_id, item_id, valid_from, valid_to) VALUES
('0001','000001','000001','2025-01-01',NULL),
('0001','000001','000002','2025-01-01',NULL),
('0001','000002','000001','2025-01-01',NULL),
('0001','000003','000001','2025-01-01',NULL);

-- 店舗0002: ベンダー1(共通), ベンダー2(共通+固有000003), ベンダー3(共通)
INSERT OR IGNORE INTO store_vendor_items (store_id, vendor_id, item_id, valid_from, valid_to) VALUES
('0002','000001','000001','2025-01-01',NULL),
('0002','000002','000001','2025-01-01',NULL),
('0002','000002','000003','2025-01-01',NULL),
('0002','000003','000001','2025-01-01',NULL);

-- 店舗0003: ベンダー2(共通), ベンダー3(共通+固有000004)  ※ベンダー1なしで差別化
INSERT OR IGNORE INTO store_vendor_items (store_id, vendor_id, item_id, valid_from, valid_to) VALUES
('0003','000002','000001','2025-01-01',NULL),
('0003','000003','000001','2025-01-01',NULL),
('0003','000003','000004','2025-01-01',NULL);

-- 共通品 '000001'
INSERT OR IGNORE INTO item_prices (vendor_id, item_id, unit_price, valid_from, valid_to) VALUES
('000001','000001', 100, '2025-01-01',NULL),
('000002','000001', 110, '2025-01-01',NULL),
('000003','000001', 120, '2025-01-01',NULL);

-- 固有品
INSERT OR IGNORE INTO item_prices (vendor_id, item_id, unit_price, valid_from, valid_to) VALUES
('000001','000002', 200, '2025-01-01',NULL),
('000002','000003', 300, '2025-01-01',NULL),
('000003','000004', 400, '2025-01-01',NULL);

-- ============ vendor_weekly_rules（全3ベンダー × 7曜日）============
-- ベース方針: 平日・土は発注可(1)、日は不可(0)。締め 04:00、LT=1日。

DELETE FROM vendor_weekly_rules;

INSERT INTO vendor_weekly_rules (vendor_id, weekday, orderable, cutoff_hhmm, lead_time_days) VALUES
-- 000001 中央物流センター
('000001',0,0,'04:00',1), -- 日
('000001',1,1,'04:00',1),
('000001',2,1,'04:00',1),
('000001',3,1,'04:00',1),
('000001',4,1,'04:00',1),
('000001',5,1,'04:00',1),
('000001',6,1,'04:00',1), -- 土

-- 000002 青果
('000002',0,0,'04:00',1),
('000002',1,1,'04:00',1),
('000002',2,1,'04:00',1),
('000002',3,1,'04:00',1),
('000002',4,1,'04:00',1),
('000002',5,1,'04:00',1),
('000002',6,1,'04:00',1),

-- 000003 精肉
('000003',0,0,'04:00',1),
('000003',1,1,'04:00',1),
('000003',2,1,'04:00',1),
('000003',3,1,'04:00',1),
('000003',4,1,'04:00',1),
('000003',5,1,'04:00',1),
('000003',6,1,'04:00',1);

-- ============ store_vendor_overrides（例）============
-- 0001 × 000001 だけ水曜は締め 03:00 に早める、ほかの曜日は週次ルールに従う
DELETE FROM store_vendor_overrides WHERE store_id='0001' AND vendor_id='000001';

INSERT INTO store_vendor_overrides (store_id, vendor_id, weekday, orderable, cutoff_hhmm, lead_time_days) VALUES
('0001','000001',3,1,'03:00',1);  -- 水曜だけ 03:00

