// frontend/src/master/apiMaster.ts
export type VendorLite = { id: string; name: string };
// export type StoreLite = { id: string; name: string };
// ★ isActive を追加（既存利用側は id/name しか見ないので壊れません）
export type StoreLite = { id: string; name: string; isActive?: 0 | 1 };

export type VendorWeeklyRuleRow = {
  vendorId: string;

  orderableSun: 0 | 1; cutoffHhmmSun: string; leadTimeDaysSun: number;
  orderableMon: 0 | 1; cutoffHhmmMon: string; leadTimeDaysMon: number;
  orderableTue: 0 | 1; cutoffHhmmTue: string; leadTimeDaysTue: number;
  orderableWed: 0 | 1; cutoffHhmmWed: string; leadTimeDaysWed: number;
  orderableThu: 0 | 1; cutoffHhmmThu: string; leadTimeDaysThu: number;
  orderableFri: 0 | 1; cutoffHhmmFri: string; leadTimeDaysFri: number;
  orderableSat: 0 | 1; cutoffHhmmSat: string; leadTimeDaysSat: number;

  updatedAt?: string | null;
};

export type StoreVendorOverrideRow = {
  storeId: string;
  vendorId: string;

  orderableSunOverride: 0 | 1 | null; cutoffHhmmSunOverride: string | null; leadTimeDaysSunOverride: number | null;
  orderableMonOverride: 0 | 1 | null; cutoffHhmmMonOverride: string | null; leadTimeDaysMonOverride: number | null;
  orderableTueOverride: 0 | 1 | null; cutoffHhmmTueOverride: string | null; leadTimeDaysTueOverride: number | null;
  orderableWedOverride: 0 | 1 | null; cutoffHhmmWedOverride: string | null; leadTimeDaysWedOverride: number | null;
  orderableThuOverride: 0 | 1 | null; cutoffHhmmThuOverride: string | null; leadTimeDaysThuOverride: number | null;
  orderableFriOverride: 0 | 1 | null; cutoffHhmmFriOverride: string | null; leadTimeDaysFriOverride: number | null;
  orderableSatOverride: 0 | 1 | null; cutoffHhmmSatOverride: string | null; leadTimeDaysSatOverride: number | null;

  updatedAt?: string | null;
};

export type ItemPriceRow = {
  id: number;
  vendorId: string;
  itemId: string;
  unitPrice: number;
  validFrom: string;
  validTo: string | null;
};

export type VendorItemLite = {
  id: string;
  name: string;
  spec?: string;
  unit?: string;
  tempZone?: string;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const url = (path: string, q?: Record<string, string | undefined>) => {
  const u = new URL(path.replace(/^\//, ""), API_BASE || window.location.origin);
  if (q) for (const [k, v] of Object.entries(q)) if (v != null && v !== "") u.searchParams.set(k, v);
  return u.toString();
};

export class ApiHttpError extends Error {
  status: number;
  statusText: string;
  body: unknown;
  constructor(status: number, statusText: string, body: unknown) {
    super(`${status} ${statusText}`);
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

async function readErrorBody(r: Response): Promise<unknown> {
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    try { return await r.json(); } catch { return null; }
  }
  try {
    const t = await r.text();
    return t ? ({ message: t } as unknown) : null;
  } catch {
    return null;
  }
}

async function getJson<T>(path: string, q?: Record<string, string | undefined>): Promise<T> {
  const r = await fetch(url(path, q));
  if (!r.ok) throw new ApiHttpError(r.status, r.statusText, await readErrorBody(r));
  return (await r.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(url(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new ApiHttpError(r.status, r.statusText, await readErrorBody(r));
  return (await r.json()) as T;
}

// ---- helpers (軽い正規化) ----
export const padVendorId = (s: string) => String(s ?? "").replace(/\D/g, "").padStart(6, "0");
export const padStoreId  = (s: string) => String(s ?? "").replace(/\D/g, "").padStart(4, "0");
export function padItemId(s: string): string {
  return String(s ?? "").replace(/\D/g, "").padStart(6, "0");
}

export type TempZone = "ambient" | "chilled" | "frozen";

export type MasterItem = {
  id: string;
  name: string;
  unit: string;
  spec: string | null;
  tempZone: TempZone;
  isActive: 0 | 1;
  stockUnit: string | null;
  stockConv: number;
};

export async function listItems(params?: { includeInactive?: boolean }): Promise<MasterItem[]> {
  const includeInactive = params?.includeInactive ? "1" : "0";
  const r = await getJson<{ items: MasterItem[] }>(`${MASTER_BASE}/items?includeInactive=${includeInactive}`);
  return r.items ?? [];
}

export type UpsertItemPayload = {
  id: string;
  name: string;
  unit: string;
  spec: string | null;
  tempZone: TempZone;
  isActive: 0 | 1;
  stockUnit: string | null;
  stockConv: number;
};

export async function upsertItem(payload: UpsertItemPayload): Promise<{ ok: true; id: string }> {
  return await postJson(`${MASTER_BASE}/items/upsert`, payload);
}

export type CsvImportError = { line: number; field?: string; message: string; value?: string };

export type ImportItemsCsvResult = {
  ok: true;
  dryRun: boolean;
  rows: number;
  inserted: number;
  updated: number;
  errors: CsvImportError[];
};

export type ImportVendorItemsCsvResult = {
  ok: true;
  dryRun: boolean;
  rows: number;
  groups: number;
  appliedGroups: number;
  noOpGroups: number;
  errors: CsvImportError[];
};

export type ImportStoreVendorItemsCsvResult = {
  ok: true;
  dryRun: boolean;
  rows: number;
  groups: number;
  appliedGroups: number;
  noOpGroups: number;
  errors: CsvImportError[];
};

export async function importStoreVendorItemsCsv(
  payload: { csv: string; dryRun?: boolean; validFrom?: string }
): Promise<ImportStoreVendorItemsCsvResult> {
  return await postJson(`${MASTER_BASE}/store-vendor-items/import`, payload);
}

export async function importVendorItemsCsv(
  payload: { csv: string; dryRun?: boolean; validFrom?: string }
): Promise<ImportVendorItemsCsvResult> {
  return await postJson(`${MASTER_BASE}/vendor-items/import`, payload);
}

export async function importItemsCsv(payload: { csv: string; dryRun?: boolean }): Promise<ImportItemsCsvResult> {
  return await postJson(`${MASTER_BASE}/items/import`, payload);
}

// ---- APIs ----
const MASTER_BASE = "/master";

// 配列 or {vendors:[...]} or {stores:[...]} or {rows:[...]} を吸収
function unwrapArray<T>(x: unknown, keys: string[]): T[] {
  if (Array.isArray(x)) return x as T[];
  if (x && typeof x === "object") {
    const rec = x as Record<string, unknown>;
    for (const k of keys) {
      const v = rec[k];
      if (Array.isArray(v)) return v as T[];
    }
  }
  return [];
}


export async function listVendors(): Promise<VendorLite[]> {
  const raw = await getJson<unknown>(`${MASTER_BASE}/vendors`);
  // 念のため vendors/rows も吸収（実装差異に強くする）
  return unwrapArray<VendorLite>(raw, ["vendors", "rows"]);
}

export async function listStores(params?: { includeInactive?: boolean }): Promise<StoreLite[]> {
  const raw = await getJson<unknown>(
    params?.includeInactive ? `${MASTER_BASE}/stores?includeInactive=1` : `${MASTER_BASE}/stores`
  );
  return unwrapArray<StoreLite>(raw, ["stores", "rows"]);
}

export type UpsertVendorPayload = { id: string; name: string };
export async function upsertVendor(payload: UpsertVendorPayload): Promise<{ ok: true; id: string }> {
  return await postJson(`${MASTER_BASE}/vendors/upsert`, {
    ...payload,
    id: padVendorId(payload.id),
    name: String(payload.name ?? "").trim(),
  });
}

export type UpsertStorePayload = { id: string; name: string; isActive: 0 | 1; code?: string };
export async function upsertStore(payload: UpsertStorePayload): Promise<{ ok: true; id: string }> {
  return await postJson(`${MASTER_BASE}/stores/upsert`, {
    ...payload,
    id: padStoreId(payload.id),
    name: String(payload.name ?? "").trim(),
    isActive: payload.isActive,
    code: payload.code ? String(payload.code).trim() : undefined,
  });
}

export async function listVendorWeeklyRules(vendorId?: string): Promise<VendorWeeklyRuleRow[]> {
  const r = await getJson<{ ok: true; rows: VendorWeeklyRuleRow[] }>(`${MASTER_BASE}/vendor-weekly-rules`, {
    vendorId: vendorId ? padVendorId(vendorId) : undefined,
  });
  return r.rows ?? [];
}

export async function upsertVendorWeeklyRule(payload: Partial<VendorWeeklyRuleRow> & { vendorId: string }) {
  return await postJson<{ ok: boolean; vendorId: string }>(`${MASTER_BASE}/vendor-weekly-rules/upsert`, {
    ...payload,
    vendorId: padVendorId(payload.vendorId),
  });
}

export async function listStoreVendorOverrides(params: { storeId?: string; vendorId?: string }) {
  const r = await getJson<{ ok: true; rows: StoreVendorOverrideRow[] }>(`${MASTER_BASE}/store-vendor-overrides`, {
    storeId: params.storeId ? padStoreId(params.storeId) : undefined,
    vendorId: params.vendorId ? padVendorId(params.vendorId) : undefined,
  });
  return r.rows ?? [];
}

export async function upsertStoreVendorOverride(
  payload: Partial<StoreVendorOverrideRow> & { storeId: string; vendorId: string }
) {
  return await postJson<{ ok: boolean; storeId: string; vendorId: string }>(`${MASTER_BASE}/store-vendor-overrides/upsert`, {
    ...payload,
    storeId: padStoreId(payload.storeId),
    vendorId: padVendorId(payload.vendorId),
  });
}

export async function listItemPrices(params: { vendorId?: string; itemId?: string; asOf?: string }) {
  const asOf = params.asOf ? String(params.asOf).trim() : "";
  const r = await getJson<{ ok: true; rows: ItemPriceRow[] }>(`${MASTER_BASE}/item-prices`, {
    vendorId: params.vendorId ? padVendorId(params.vendorId) : undefined,
    itemId: params.itemId ? padItemId(params.itemId) : undefined,
    asOf: asOf ? asOf : undefined,
  });
  return r.rows ?? [];
}

export async function upsertItemPrice(
  payload: Partial<ItemPriceRow> & { vendorId: string; itemId: string; unitPrice: number }
) {
  return await postJson<{ ok: boolean; id: number }>(`${MASTER_BASE}/item-prices/upsert`, {
    ...payload, // ← ここが重要（.payload ではなく spread）
    vendorId: padVendorId(payload.vendorId),
    itemId: padItemId(payload.itemId),
  });
}

export async function listVendorItems(vendorId: string): Promise<VendorItemLite[]> {
  const vid = padVendorId(vendorId);
  const raw = await getJson<unknown>(`${MASTER_BASE}/vendors/${encodeURIComponent(vid)}/items`);
  return unwrapArray<VendorItemLite>(raw, ["items", "rows"]);
}

// ★ vendor_items（期間管理）用：/master/vendor-items
export type VendorItemPeriodRow = {
  id: number;
  vendorId: string;
  itemId: string;
  validFrom: string;
  validTo: string | null;
};


export async function listVendorItemPeriods(params: {
  vendorId: string;
  asOf?: string;
}): Promise<VendorItemPeriodRow[]> {
  const vid = padVendorId(params.vendorId);
  const asOf = params.asOf ? String(params.asOf).trim() : "";
  const qs = asOf
    ? `?vendorId=${encodeURIComponent(vid)}&asOf=${encodeURIComponent(asOf)}`
    : `?vendorId=${encodeURIComponent(vid)}`;

  const r = await getJson<{ ok: boolean; rows: VendorItemPeriodRow[] }>(`${MASTER_BASE}/vendor-items${qs}`);
  return r.rows ?? [];
}

export async function replaceCurrentVendorItemPeriods(payload: {
  vendorId: string;
  validFrom: string;
  itemIds: string[];
}): Promise<{ ok: true; vendorId: string; validFrom: string; count: number; noOp?: boolean }> {
  return await postJson(`${MASTER_BASE}/vendor-items/replace-current`, {
    vendorId: padVendorId(payload.vendorId),
    validFrom: payload.validFrom,
    itemIds: payload.itemIds.map(padItemId),
  });
}

export type ToggleChange = { itemId: string; enabled: boolean };

export async function toggleVendorItemPeriods(payload: {
  vendorId: string;
  validFrom: string;
  changes: ToggleChange[];
}): Promise<{ ok: true; vendorId: string; validFrom: string; requested: number; applied: number; noOp: boolean }> {
  return await postJson("/master/vendor-items/toggle", payload);
}

export async function toggleStoreVendorItemPeriods(payload: {
  storeId: string;
  vendorId: string;
  validFrom: string;
  changes: ToggleChange[];
}): Promise<{ ok: true; storeId: string; vendorId: string; validFrom: string; requested: number; applied: number; noOp: boolean }> {
  return await postJson("/master/store-vendor-items/toggle", payload);
}

// ★ store_vendor_items（期間管理） ----------------------------

export type StoreVendorItemPeriodRow = {
  id: number;
  storeId: string;
  vendorId: string;
  itemId: string;
  validFrom: string;
  validTo: string | null;

  // backend が返すなら表示用（無くてもOK）
  itemName?: string;
  spec?: string;
  unit?: string;
  tempZone?: string;
};

export async function listStoreVendorItemPeriods(params: {
  storeId: string;
  vendorId: string;
  asOf?: string;
}): Promise<StoreVendorItemPeriodRow[]> {
  const storeId = padStoreId(params.storeId);
  const vendorId = padVendorId(params.vendorId);
  const asOf = params.asOf ? String(params.asOf).trim() : undefined;

  const r = await getJson<{ ok: true; rows: StoreVendorItemPeriodRow[] }>(`${MASTER_BASE}/store-vendor-items`, {
    storeId,
    vendorId,
    asOf,
  });
  return r.rows ?? [];
}

export async function replaceCurrentStoreVendorItemPeriods(payload: {
  storeId: string;
  vendorId: string;
  validFrom: string;
  itemIds: string[];
}): Promise<{ ok: true; storeId: string; vendorId: string; validFrom: string; count: number; noOp?: boolean }> {
  return await postJson(`${MASTER_BASE}/store-vendor-items/replace-current`, {
    storeId: padStoreId(payload.storeId),
    vendorId: padVendorId(payload.vendorId),
    validFrom: payload.validFrom,
    itemIds: payload.itemIds.map(padItemId),
  });
}

export type ImportItemPricesCsvResult = {
  ok: true;
  dryRun: boolean;
  rows: number;
  inserted: number;
  updated: number;
  errors: CsvImportError[];
};

export async function importItemPricesCsv(
  payload: { csv: string; dryRun?: boolean }
): Promise<ImportItemPricesCsvResult> {
  return await postJson(`${MASTER_BASE}/item-prices/import`, payload);
}