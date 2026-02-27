 export const TEMP_ZONES = ["ambient", "chilled", "frozen"] as const;
 export type TempZone = (typeof TEMP_ZONES)[number];

 export const TEMP_ZONE_LABEL: Record<TempZone, string> = {
   ambient: "常温",
   chilled: "チルド",
   frozen: "冷凍",
 };

// select 用の共通 option 生成
export type SelectOption<T extends string> = { value: T; label: string };
function makeOptions<T extends string>(
  values: readonly T[],
  labels: Record<T, string>
): SelectOption<T>[] {
  return values.map((v) => ({ value: v, label: labels[v] }));
}

 // 検品一覧のフィルタ（UI用）
 // ※ inspection.status の completed/audited をまとめて「confirmed(検収済み)」扱いにしているため、別定義にする
 export const INSPECTION_LIST_STATUS_FILTERS = ["all", "open", "confirmed"] as const;
 export type InspectionListStatusFilter = (typeof INSPECTION_LIST_STATUS_FILTERS)[number];

 export const INSPECTION_LIST_STATUS_FILTER_LABEL: Record<InspectionListStatusFilter, string> = {
   all: "全て",
   open: "未検収",
   confirmed: "検収済み",
 };

 export const SHIPMENT_STATUS = ["open", "confirmed", "canceled"] as const;
 export type ShipmentStatus = (typeof SHIPMENT_STATUS)[number];

 export const INSPECTION_STATUS = ["open", "completed", "audited"] as const;
 export type InspectionStatus = (typeof INSPECTION_STATUS)[number];

 export const STORE_SHIPMENT_STATUS = ["draft", "confirmed"] as const;
 export type StoreShipmentStatus = (typeof STORE_SHIPMENT_STATUS)[number];

 export const STORE_SHIPMENT_MOVE = ["TRANSFER", "DISPOSAL"] as const;
 export type StoreShipmentMovementType = (typeof STORE_SHIPMENT_MOVE)[number];

// 在庫移動（store_stock_movements 等）
export const STOCK_MOVEMENT_TYPES = ["RECEIPT", "ISSUE", "ADJUST"] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];
export function isTempZone(v: unknown): v is TempZone {
  return typeof v === "string" && (TEMP_ZONES as readonly string[]).includes(v);
}

 export function toTempZoneOrUndef(v: unknown): TempZone | undefined {
   return isTempZone(v) ? v : undefined;
 }
 
 export const STORE_SHIPMENT_MOVE_LABEL: Record<StoreShipmentMovementType, string> = {
   TRANSFER: "店舗移動",
   DISPOSAL: "廃棄",
 };

 export const STORE_SHIPMENT_STATUS_LABEL: Record<StoreShipmentStatus, string> = {
   draft: "下書き",
   confirmed: "確定",
 };

 export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
   open: "未確定",
   confirmed: "確定済み",
   canceled: "取消",
 };

 export const INSPECTION_STATUS_LABEL: Record<InspectionStatus, string> = {
   open: "未検収",
   completed: "検収済み",
   audited: "監査済み",
 };

export const STOCK_MOVEMENT_TYPE_LABEL: Record<StockMovementType, string> = {
  RECEIPT: "入庫",
  ISSUE: "出庫",
  ADJUST: "調整",
};

// UI 用 options（select にそのまま渡せる）
export const TEMP_ZONE_OPTIONS = makeOptions(TEMP_ZONES, TEMP_ZONE_LABEL);
export const INSPECTION_LIST_STATUS_FILTER_OPTIONS = makeOptions(
  INSPECTION_LIST_STATUS_FILTERS,
  INSPECTION_LIST_STATUS_FILTER_LABEL
);
export const SHIPMENT_STATUS_OPTIONS = makeOptions(SHIPMENT_STATUS, SHIPMENT_STATUS_LABEL);
export const INSPECTION_STATUS_OPTIONS = makeOptions(INSPECTION_STATUS, INSPECTION_STATUS_LABEL);
export const STORE_SHIPMENT_STATUS_OPTIONS = makeOptions(
  STORE_SHIPMENT_STATUS,
  STORE_SHIPMENT_STATUS_LABEL
);
export const STORE_SHIPMENT_MOVE_OPTIONS = makeOptions(
  STORE_SHIPMENT_MOVE,
  STORE_SHIPMENT_MOVE_LABEL
);
export const STOCK_MOVEMENT_TYPE_OPTIONS = makeOptions(
  STOCK_MOVEMENT_TYPES,
  STOCK_MOVEMENT_TYPE_LABEL
);

export function isStockMovementType(v: unknown): v is StockMovementType {
  return typeof v === "string" && (STOCK_MOVEMENT_TYPES as readonly string[]).includes(v);
}
export function toStockMovementTypeOrUndef(v: unknown): StockMovementType | undefined {
  return isStockMovementType(v) ? v : undefined;
}
