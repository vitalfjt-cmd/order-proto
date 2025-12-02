// src/inspection/inspectionApi.ts
// 検品API（サーバー連携版）

import type { VendorOrderHeader, VendorOrderLine } from "../vendor/apiVendor";

// ===== 型定義 =====

export type OwnerType = "STORE" | "DC";

export type InspectionStatus = "open" | "completed" | "audited";

export interface InspectionHeader {
  id: number;
  shipmentId: number;
  ownerId: string;
  status: InspectionStatus;
  createdAt: string;
  updatedAt: string;
  vendorId: string;
  destinationId: string;
  destinationName: string;
  deliveryDate: string; // YYYY-MM-DD
}

export interface InspectionLine {
  id: number;
  inspectionId: number;
  itemId: string;
  shipQty: number;
  inspectedQty: number;
  diffQty: number;
  unit: string | null;
  spec: string | null;
  tempZone: string | null;
  lotNo: string | null;
  note: string | null;
  itemName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenerateFromShipmentsResult {
  ok: boolean;
  createdHeaders: number;
  createdLines: number;
  processedShipments: number;
  skippedShipments: number;
}

// ===== 検品検索（店舗/DC 共通・暫定版） =====

export interface SearchInspectionsParams {
  from?: string;
  to?: string;
  vendorId?: string;
  ownerType: OwnerType;   // いまは未使用だが将来 DC 用で使う想定
  ownerId: string;
}

/**
 * 検品一覧検索API（暫定実装）
 *
 * 現状のサーバー側は ownerId 単位の一覧のみなので、
 * from / to / vendorId は無視して ownerId だけで検索します。
 * フィルタが必要になったらサーバー側の /inspections を拡張します。
 */
// export async function searchInspections(
//   params: SearchInspectionsParams
// ): Promise<{ headers: InspectionHeader[]; lines: InspectionLine[] }> {
//   // いったん ownerId だけ渡して既存APIを呼ぶ
//   // return fetchInspectionsByOwner({ ownerId: params.ownerId });
//     return fetchInspectionsByOwner({
//     ownerId: params.ownerId,
//     from: params.from,
//     to: params.to,
//     vendorId: params.vendorId,
//   });
// }
export async function searchInspections(
  params: SearchInspectionsParams
): Promise<{ headers: InspectionHeader[]; lines: InspectionLine[] }> {
  return fetchInspections({
    ownerType: params.ownerType,
    ownerId: params.ownerId,
    from: params.from,
    to: params.to,
    vendorId: params.vendorId,
  });
}

// ===== 共通ヘルパー =====

async function getJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

async function fetchInspections(params: {
  ownerType: OwnerType;
  ownerId: string;
  from?: string;
  to?: string;
  vendorId?: string;
}): Promise<{ headers: InspectionHeader[]; lines: InspectionLine[] }> {
  const usp = new URLSearchParams();

  // ★ DC/STORE をサーバーに伝える
  usp.set("ownerType", params.ownerType);

  if (params.ownerId) usp.set("ownerId", params.ownerId);
  if (params.from) usp.set("from", params.from);
  if (params.to) usp.set("to", params.to);
  if (params.vendorId) usp.set("vendorId", params.vendorId);

  const data = await getJson<{
    headers?: InspectionHeader[];
    lines?: InspectionLine[];
  }>(`/inspections?${usp.toString()}`);

  return {
    headers: data.headers ?? [],
    lines: data.lines ?? [],
  };
}

// ===== 検品一覧取得（店舗側・将来の検品画面用） =====
// export async function fetchInspectionsByOwner(params: {
//   ownerId: string;           // 店舗ID（"0001" など）
//   from?: string;
//   to?: string;
//   vendorId?: string;
// }): Promise<{ headers: InspectionHeader[]; lines: InspectionLine[] }> {
//    const usp = new URLSearchParams();
//   // if (params.ownerId) usp.set("ownerId", params.ownerId);
//   if (params.ownerId) usp.set("ownerId", params.ownerId);
//   if (params.from) usp.set("from", params.from);
//   if (params.to) usp.set("to", params.to);
//   if (params.vendorId) usp.set("vendorId", params.vendorId);

//   const data = await getJson<{
//     ok?: boolean;
//     headers?: InspectionHeader[];
//     lines?: InspectionLine[];
//   }>(`/inspections?${usp.toString()}`);

//   return {
//     headers: data.headers ?? [],
//     lines: data.lines ?? [],
//   };
// }
export async function fetchInspectionsByOwner(params: {
  ownerId: string;           // 店舗ID（"0001" など）
  from?: string;
  to?: string;
  vendorId?: string;
}): Promise<{ headers: InspectionHeader[]; lines: InspectionLine[] }> {
  return fetchInspections({
    ownerType: "STORE",
    ownerId: params.ownerId,
    from: params.from,
    to: params.to,
    vendorId: params.vendorId,
  });
}


// ===== 出荷→検品の自動生成（ベンダー確定時） =====

/**
 * VendorShipments.handleConfirm から呼ばれる。
 *
 * 役割:
 * - 確定された出荷ヘッダを店舗ごとにまとめる
 * - 店舗ごとに /inspections/generate-from-shipments を呼び出して
 *   inspections / inspection_lines をサーバー側に生成させる
 *
 * 備考:
 * - lines 引数は将来の拡張用。現在の実装ではサーバーが shipment_lines を参照するため未使用。
 */
export async function ensureFromShipments(
  headers: VendorOrderHeader[],
  _lines: VendorOrderLine[],
  targetHeaderIds: string[]
): Promise<void> {
  if (!targetHeaderIds.length) return;

  // id → header のマップ
  const hMap = new Map(headers.map(h => [h.id, h]));

  // 納品先（店舗）ごとにヘッダIDをまとめる
  const byOwner = new Map<string, number[]>(); // ownerId(storeId) -> shipment ids

  for (const idStr of targetHeaderIds) {
    const h = hMap.get(idStr);
    if (!h) continue;

    const ownerIdRaw = h.destinationId;
    if (!ownerIdRaw) continue;

    const ownerId = String(ownerIdRaw).padStart(4, "0"); // STORE ID 正規化
    const shipmentId = Number(h.id);
    if (!Number.isFinite(shipmentId)) continue;

    if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
    byOwner.get(ownerId)!.push(shipmentId);
  }

  const tasks: Promise<GenerateFromShipmentsResult>[] = [];

  for (const [ownerId, shipmentHeaderIds] of byOwner.entries()) {
    if (!shipmentHeaderIds.length) continue;

    const payload = {
      ownerType: "STORE" as OwnerType,
      ownerId,
      shipmentHeaderIds,
    };

    tasks.push(
      getJson<GenerateFromShipmentsResult>("/inspections/generate-from-shipments", {
        method: "POST",
        body: JSON.stringify(payload),
      })
    );
  }

  // 失敗があれば例外を投げる（VendorShipments 側で try/catch 済み）
  await Promise.all(tasks);
}

// ===== 検品 確定API =====

/**
 * 検品を「completed」にする。
 * ids は number でも string でもOK。
 */
export async function confirmInspections(
  ids: (string | number)[]
): Promise<void> {
  // 数値化 & 不正値除外
  const bodyIds = ids
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));

  if (bodyIds.length === 0) {
    return;
  }

  await getJson<{ updated: number }>("/inspections/confirm", {
    method: "POST",
    body: JSON.stringify({ ids: bodyIds }),
  });
}


// ===== 単票取得 =====

export async function getInspection(inspectionId: string | number): Promise<{
  header: InspectionHeader;
  lines: (InspectionLine & { itemName?: string })[];
}> {
  const idStr = String(inspectionId);
  const data = await getJson<{
    ok?: boolean;
    header: InspectionHeader;
    lines: (InspectionLine & { itemName?: string })[];
  }>(`/inspections/${encodeURIComponent(idStr)}`);

  if (!data.ok) {
    throw new Error("failed to load inspection");
  }

  return {
    header: data.header,
    lines: data.lines ?? [],
  };
}

// ===== 明細保存 =====

export async function saveInspectionLines(
  inspectionId: string | number,
  lines: (Pick<InspectionLine, "id" | "inspectedQty" | "lotNo" | "note">)[]
): Promise<void> {
  const idStr = String(inspectionId);

  await getJson<{ ok: boolean }>(`/inspections/${encodeURIComponent(idStr)}/lines`, {
    method: "PATCH",
    body: JSON.stringify({
      lines,
    }),
  });
}
