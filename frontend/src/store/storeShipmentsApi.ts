// frontend/src/store/storeShipmentsApi.ts
//---修正ｓ
export type { InspectionStatus } from "../domain/codes";

import type { StoreShipmentStatus, StoreShipmentMovementType } from "../domain/codes";
export type { StoreShipmentStatus, StoreShipmentMovementType };

export type StoreShipmentHeader = {
  id: number;
  fromStoreId: string;
  toStoreId: string | null;
  movementType: StoreShipmentMovementType;
  shipmentDate: string;
  status: StoreShipmentStatus;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
};

// ★ 明細用
export type StoreShipmentLine = {
  id?: number;
  lineNo?: number;
  itemId: string;
  itemName?: string | null;   // ★追加
  qty: number;
  unit: string | null;
  memo: string | null;
  // backendが返してるので、ついでに（任意）
  unitCost?: number;
  amount?: number;
};

// ★ 保存用 payload の型
export type SaveStoreShipmentHeader = {
  id?: number | null;
  fromStoreId: string;
  toStoreId?: string | null;
  movementType: StoreShipmentMovementType;
  shipmentDate: string;
  memo?: string | null;
};

export type SaveStoreShipmentLine = {
  id?: number | null;
  lineNo?: number | null;
  itemId: string;
  qty: number;
  unit?: string | null;
  memo?: string | null;
};

export type SaveStoreShipmentPayload = {
  header: SaveStoreShipmentHeader;
  lines: SaveStoreShipmentLine[];
};

export type SearchStoreShipmentsParams = {
  storeId: string;
  from?: string;
  to?: string;
  movementType?: StoreShipmentMovementType;
  status?: StoreShipmentStatus;
  slipNo?: string; // ★伝票番号（id）
};


async function getJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: "same-origin",
    ...(init ?? {}),
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

// 一覧取得
export async function searchStoreShipments(
  params: SearchStoreShipmentsParams
): Promise<StoreShipmentHeader[]> {
  const qs = new URLSearchParams();
  qs.set("storeId", params.storeId);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.movementType) qs.set("movementType", params.movementType);
  if (params.status) qs.set("status", params.status);
  if (params.slipNo) qs.set("slipNo", params.slipNo);

  const data = await getJson<{ headers: StoreShipmentHeader[] }>(
    `/store/shipments?${qs.toString()}`
  );
  return data.headers ?? [];
}

// 単票取得
export async function fetchStoreShipmentDetail(
  id: number
): Promise<{ header: StoreShipmentHeader; lines: StoreShipmentLine[] }> {
  return getJson<{ header: StoreShipmentHeader; lines: StoreShipmentLine[] }>(
    `/store/shipments/${id}`
  );
}

// 確定
export async function confirmStoreShipments(
  ids: number[]
): Promise<{ updated: number }> {
  if (ids.length === 0) return { updated: 0 };

  const res = await fetch("/store/shipments/confirm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ ids }),
    credentials: "same-origin",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<{ updated: number }>;
}

// 保存（新規/更新共通）
export async function saveStoreShipment(
  payload: SaveStoreShipmentPayload
): Promise<{ ok: boolean; shipmentId: number }> {
  const res = await fetch("/store/shipments/save", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
    credentials: "same-origin",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<{ ok: boolean; shipmentId: number }>;
}

// ★ 店舗マスタ（モーダル用）
export type MasterStore = { id: string; name: string | null };

export async function listMasterStores(): Promise<MasterStore[]> {
  return await getJson<MasterStore[]>("/master/stores");
}

// ★ 移動可能品目（在庫>0）モーダル用
export type MovableItem = {
  itemId: string;
  itemName: string | null;
  onHandQty: number;
  unit: string | null;
  stockUnit: string | null;
  stockConv: number;
};

export async function listMovableItems(params: {
  storeId: string;
  q?: string;
  limit?: number;
}): Promise<MovableItem[]> {
  const qs = new URLSearchParams();
  qs.set("storeId", params.storeId);
  if (params.q) qs.set("q", params.q);
  if (params.limit) qs.set("limit", String(params.limit));

  const data = await getJson<{ ok: boolean; items: MovableItem[] }>(
    `/store/shipments/movable-items?${qs.toString()}`
  );
  return data.items ?? [];
}
