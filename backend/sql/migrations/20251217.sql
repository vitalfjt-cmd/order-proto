BEGIN;

WITH src AS (
  SELECT
    m.id AS movement_id,
    (il.inspected_qty * COALESCE(sl.unit_price, 0)) AS calc_amount,
    CASE
      WHEN m.qty != 0 THEN (il.inspected_qty * COALESCE(sl.unit_price, 0)) / m.qty
      ELSE NULL
    END AS calc_unit_cost
  FROM store_stock_movements m
  JOIN inspections i
    ON i.id = m.ref_id
  JOIN shipments s
    ON s.id = i.shipment_id
  JOIN inspection_lines il
    ON il.inspection_id = i.id
   AND il.item_id = m.item_id
  JOIN items it
    ON it.id = m.item_id
  LEFT JOIN shipment_lines sl
    ON sl.shipment_id = s.id
   AND sl.item_id = m.item_id
  WHERE
    m.movement_type = 'RECEIPT'
    AND m.ref_type = 'inspection'
    AND (m.amount IS NULL OR m.unit_cost IS NULL)
    AND il.inspected_qty > 0
    AND COALESCE(sl.unit_price, 0) > 0
    AND ABS(m.qty - (il.inspected_qty * COALESCE(NULLIF(it.stock_conv,0),1.0))) < 0.000001
)
UPDATE store_stock_movements
SET
  amount    = (SELECT calc_amount    FROM src WHERE src.movement_id = store_stock_movements.id),
  unit_cost = (SELECT calc_unit_cost FROM src WHERE src.movement_id = store_stock_movements.id)
WHERE id IN (SELECT movement_id FROM src);

COMMIT;
