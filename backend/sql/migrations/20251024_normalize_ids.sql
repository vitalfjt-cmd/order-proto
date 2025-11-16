BEGIN;

-- stores: 'S001' -> '0001'
UPDATE stores SET id   = printf('%04d', CAST(substr(id,   2) AS INTEGER)) WHERE id   GLOB 'S[0-9][0-9][0-9]';
UPDATE stores SET code = printf('%04d', CAST(substr(code, 2) AS INTEGER)) WHERE code GLOB 'S[0-9][0-9][0-9]';

-- vendors: 'VND01' -> '000001'
UPDATE vendors SET id = printf('%06d', CAST(substr(id, 4) AS INTEGER)) WHERE id GLOB 'VND[0-9][0-9]';

-- items: 'ITM001' -> '000001'
UPDATE items SET id = printf('%06d', CAST(substr(id, 4) AS INTEGER)) WHERE id GLOB 'ITM[0-9][0-9][0-9]';

-- references
UPDATE item_prices SET vendor_id = printf('%06d', CAST(substr(vendor_id, 4) AS INTEGER)) WHERE vendor_id GLOB 'VND[0-9][0-9]';
UPDATE item_prices SET item_id   = printf('%06d', CAST(substr(item_id,   4) AS INTEGER)) WHERE item_id   GLOB 'ITM[0-9][0-9][0-9]';

UPDATE vendor_weekly_rules SET vendor_id = printf('%06d', CAST(substr(vendor_id, 4) AS INTEGER)) WHERE vendor_id GLOB 'VND[0-9][0-9]';

UPDATE store_vendor_overrides
  SET store_id  = printf('%04d', CAST(substr(store_id,  2) AS INTEGER))
WHERE store_id  GLOB 'S[0-9][0-9][0-9]';
UPDATE store_vendor_overrides
  SET vendor_id = printf('%06d', CAST(substr(vendor_id, 4) AS INTEGER))
WHERE vendor_id GLOB 'VND[0-9][0-9]';

UPDATE orders
  SET store_id  = printf('%04d', CAST(substr(store_id,  2) AS INTEGER))
WHERE store_id  GLOB 'S[0-9][0-9][0-9]';
UPDATE orders
  SET vendor_id = printf('%06d', CAST(substr(vendor_id, 4) AS INTEGER))
WHERE vendor_id GLOB 'VND[0-9][0-9]';

UPDATE order_lines
  SET item_id   = printf('%06d', CAST(substr(item_id,   4) AS INTEGER))
WHERE item_id   GLOB 'ITM[0-9][0-9][0-9]';

COMMIT;
