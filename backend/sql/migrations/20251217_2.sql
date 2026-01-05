BEGIN;

WITH targets AS (
  SELECT id, store_id, item_id, movement_date, qty
  FROM store_stock_movements
  WHERE movement_type='RECEIPT'
    AND ref_type='inspection'
    AND (amount IS NULL OR unit_cost IS NULL)
),
picked AS (
  SELECT
    t.id AS movement_id,
    COALESCE(
      (SELECT m2.unit_cost
         FROM store_stock_movements m2
        WHERE m2.store_id = t.store_id
          AND m2.item_id  = t.item_id
          AND m2.unit_cost IS NOT NULL
          AND m2.movement_date <= t.movement_date
        ORDER BY m2.movement_date DESC, m2.id DESC
        LIMIT 1),
      (SELECT m2.unit_cost
         FROM store_stock_movements m2
        WHERE m2.item_id  = t.item_id
          AND m2.unit_cost IS NOT NULL
          AND m2.movement_date <= t.movement_date
        ORDER BY m2.movement_date DESC, m2.id DESC
        LIMIT 1)
    ) AS picked_unit_cost
  FROM targets t
)
UPDATE store_stock_movements
SET
  unit_cost = (SELECT picked_unit_cost FROM picked WHERE picked.movement_id = store_stock_movements.id),
  amount    = qty * (SELECT picked_unit_cost FROM picked WHERE picked.movement_id = store_stock_movements.id)
WHERE id IN (SELECT movement_id FROM picked)
  AND (SELECT picked_unit_cost FROM picked WHERE picked.movement_id = store_stock_movements.id) IS NOT NULL;

COMMIT;
