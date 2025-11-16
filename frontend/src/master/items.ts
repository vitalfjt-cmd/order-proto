// src/master/items.ts
import type { TempZone } from "../vendor/apiVendor";

export interface ItemMasterRow {
  id: string;        // 品目コード
  name: string;      // 品目名
  unit: string;      // 単位（例: c/s, 箱）
  spec?: string;     // 規格
  tempZone?: TempZone;
}

// ★必要に応じて増やしてください
export const ITEMS: ItemMasterRow[] = [
  { id: "ITM001", name: "鶏もも肉", unit: "c/s", spec: "2kg", tempZone: "chilled" },
  { id: "ITM002", name: "冷凍枝豆", unit: "c/s", spec: "1kg", tempZone: "frozen" },
  { id: "ITM003", name: "カット野菜", unit: "c/s", spec: "500g", tempZone: "chilled" },
];
// export const ITEMS: ItemMasterRow[] = [
//   { id: "ITM001", name: "鶏もも肉", unit: "c/s", spec: "2kg", tempZone: "チルド" as TempZone},
//   { id: "ITM002", name: "冷凍枝豆", unit: "c/s", spec: "1kg", tempZone: "冷凍" as TempZone},
//   { id: "ITM003", name: "カット野菜", unit: "c/s", spec: "500g", tempZone: "チルド"as TempZone },
// ];
