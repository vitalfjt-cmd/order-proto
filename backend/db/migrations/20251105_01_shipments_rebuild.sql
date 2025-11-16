PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

-- 必要なら一意制約だけ整える
CREATE UNIQUE INDEX IF NOT EXISTS ux_shipments_vendor_dest_date
  ON shipments (vendor_id, destination_id, delivery_date);

-- status/destination_name が無い環境だった場合に備えた再構築が必要なら、
-- Aパッチ相当の「新テーブルに移し替え」版を適用してください（必要時お渡しします）。

COMMIT;

