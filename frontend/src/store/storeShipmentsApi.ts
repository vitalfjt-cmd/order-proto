// frontend/src/store/storeShipmentsApi.ts
//---修正ｓ
export type StoreShipmentStatus = "draft" | "confirmed";
export type StoreShipmentMovementType = "TRANSFER" | "DISPOSAL";

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
  qty: number;
  unit: string | null;
  memo: string | null;
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
//---修正e

// export type StoreShipmentStatus = "draft" | "confirmed";
// export type StoreShipmentMovementType = "TRANSFER" | "DISPOSAL";


// export type StoreShipmentHeader = {
//   id: number;
//   fromStoreId: string;
//   toStoreId: string | null;
//   movementType: StoreShipmentMovementType;
//   shipmentDate: string;
//   status: StoreShipmentStatus;
//   memo: string | null;
//   createdAt: string;
//   updatedAt: string;
// };

export type SearchStoreShipmentsParams = {
  storeId: string;
  from?: string;
  to?: string;
  movementType?: StoreShipmentMovementType;
  status?: StoreShipmentStatus;
};

async function getJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
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
): Promise<{ ok: boolean; headerId: number }> {
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
  return res.json() as Promise<{ ok: boolean; headerId: number }>;
}

