// --- API raw types (from backend v_* views) -----------------
export type ApiShipmentHeader = {
  id: number;
  order_date: string;
  delivery_date: string;
  status: 'open' | 'confirmed' | 'canceled';
  vendor_id: string;
  vendor_name?: string | null;
  destination_id: string;
  destination_name?: string | null;
  created_at: string;
  updated_at: string;
};

export type ApiShipmentLine = {
  id: number;
  shipment_id: number;
  item_id: string;
  item_name?: string | null;
  ordered_qty: number | null;
  ship_qty: number | null;
  unit_price: number | null;
  amount: number | null;
  unit?: string | null;
  spec?: string | null;
  temp_zone?: 'ambient' | 'chilled' | 'frozen' | null;
  lot_no?: string | null;
  note?: string | null;
};

export type VendorOrderHeader = {
  id: string;
  orderDate: string;
  deliveryDate: string;
  status: 'open'|'confirmed'|'canceled';
  vendorId: string;
  vendorName?: string;
  destinationId: string;
  destinationName?: string;
};
export type VendorOrderLine = {
  lineId: string;
  headerId: string;
  itemId: string;
  itemName?: string;
  orderedQty: number;
  shipQty: number;
  unitPrice?: number;
  amount?: number;
  unit?: string;
  spec?: string;
  tempZone?: 'ambient'|'chilled'|'frozen';
  lotNo?: string;
  note?: string;
};

export type MasterVendor = {
  id: string;
  name: string;   // ★ これを追加
};


// type RawVendor = { id?: unknown; vendor_id?: unknown; code?: unknown; name?: unknown; vendor_name?: unknown };

// サーバ応答（camel / snake 両対応）の生型定義
type RawHeaderCamel = {
  id: number;
  orderDate: string;
  deliveryDate: string;
  status: 'open'|'confirmed'|'canceled';
  vendorId: string;
  vendorName?: string | null;
  destinationId: string;
  destinationName?: string | null;
};
type RawHeaderSnake = {
  id: number;
  order_date: string;
  delivery_date: string;
  status: 'open'|'confirmed'|'canceled';
  vendor_id: string;
  vendor_name?: string | null;
  destination_id: string;
  destination_name?: string | null;
};

type RawLineCamel = {
  id: number;
  lineId?: string|number;
  headerId?: string|number;
  shipment_id?: number;
  itemId: string;
  itemName?: string | null;
  orderedQty?: number | null;
  shipQty?: number | null;
  unitPrice?: number | null;
  amount?: number | null;
  unit?: string | null;
  spec?: string | null;
  tempZone?: TempZone | null;
  lotNo?: string | null;
  note?: string | null;
};
type RawLineSnake = {
  id: number;
  lineId?: string|number;
  headerId?: string|number;
  shipment_id?: number;
  item_id: string;
  item_name?: string | null;
  ordered_qty?: number | null;
  ship_qty?: number | null;
  unit_price?: number | null;
  amount?: number | null;
  unit?: string | null;
  spec?: string | null;
  temp_zone?: TempZone | null;
  lot_no?: string | null;
  note?: string | null;
};

type GetShipmentResponse = {
  header: RawHeaderCamel | RawHeaderSnake | null;
  lines: Array<RawLineCamel | RawLineSnake> | null;
};

export type MasterStore = { id: string; name?: string | null };

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const url = (path: string, q?: Record<string, string | undefined>) => {
  const u = new URL(path.replace(/^\//, ""), API_BASE || window.location.origin);
  if (q) for (const [k, v] of Object.entries(q)) if (v != null && v !== "") u.searchParams.set(k, v);
  return u.toString();
};

// 追加：安全な型ガード
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function isArrayOfRecord(v: unknown): v is Record<string, unknown>[] {
  return Array.isArray(v) && v.every(isRecord);
}

// itemId を 6桁ゼロ埋めの数値文字列へ正規化（例: "016019"）
function toItemId(s: string): string {
  return String(s ?? "").replace(/\D/g, "").padStart(6, "0");
}

async function getJson<T>(path: string, q?: Record<string, string | undefined>): Promise<T> {
  const r = await fetch(url(path, q));
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(url(path), { method: "POST", headers: { "Content-Type":"application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}
async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(url(path), { method: "PATCH", headers: { "Content-Type":"application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}

// 追加（どこでもOK、型定義の近くに）
export type TempZone = 'ambient' | 'chilled' | 'frozen';

// 一覧＋明細まとめ取得（ピッキングなどで使う）
export async function searchShipments(params: { dateFrom?: string; dateTo?: string; vendorId?: string; destinationId?: string; headerId?: string }) {
  const q = new URLSearchParams();
  if (params.dateFrom) q.set('from', params.dateFrom);
  if (params.dateTo) q.set('to', params.dateTo);
  if (params.vendorId) q.set('vendorId', params.vendorId);
  if (params.destinationId) q.set('destinationId', params.destinationId);
  // const headers = await getJson<ApiShipmentHeader[]>("/shipments", {
  //   from: params.dateFrom, to: params.dateTo,
  //   vendorId: params.vendorId, destinationId: params.destinationId,
  // });
  const headers = await getJson<ApiShipmentHeader[]>("/shipments", {
    from: params.dateFrom,
    to: params.dateTo,
    vendorId: params.vendorId,
    destinationId: params.destinationId,
    headerId: params.headerId, // ★ 伝票番号（ヘッダID）検索を追加
  });
  // 必要に応じて各伝票の明細も取りにいく（最小：一覧だけ返す）
  const lines: VendorOrderLine[] = [];
  for (const h of headers) {
    // const r2 = await fetch(`/shipments/${h.id}/lines`);
    const ls = await getJson<ApiShipmentLine[]>(`/shipments/${h.id}/lines`);
      lines.push(
        ...ls.map((x): VendorOrderLine => ({
          lineId: String(x.id),
          headerId: String(h.id),
          itemId: x.item_id,
          itemName: x.item_name ?? '',
          orderedQty: Number(x.ordered_qty ?? 0),
          shipQty: Number(x.ship_qty ?? 0),
          unitPrice: Number(x.unit_price ?? 0),
          amount: Number(x.amount ?? 0),
          unit: x.unit ?? '',
          spec: x.spec ?? '',
          tempZone: x.temp_zone ?? undefined,
          lotNo: x.lot_no ?? '',
          note: x.note ?? '',
        }))
      );
  }
  // 旧：headers.map(h => ({ ... ?? h.deliveryDate ... }))
// ↓ 新：ApiShipmentHeader(snake_case) → VendorOrderHeader(camelCase) に正規化
return {
  headers: headers.map((h): VendorOrderHeader => ({
    id: String(h.id),
    orderDate: h.order_date,
    deliveryDate: h.delivery_date,
    status: h.status,
    vendorId: h.vendor_id,
    vendorName: h.vendor_name ?? undefined,
    destinationId: h.destination_id,
    destinationName: h.destination_name ?? undefined,
  })),
  lines,
};
}

export async function getShipment(id: string) {
  const raw = await getJson<GetShipmentResponse>(`/shipments/${id}`);

  // header 変換（camel / snake 両対応）
  const header: VendorOrderHeader | undefined = raw.header
    ? {
        id: String(raw.header.id),
        orderDate: 'orderDate' in raw.header
          ? raw.header.orderDate
          : (raw.header as RawHeaderSnake).order_date,
        deliveryDate: 'deliveryDate' in raw.header
          ? raw.header.deliveryDate
          : (raw.header as RawHeaderSnake).delivery_date,
        status: raw.header.status,
        vendorId: 'vendorId' in raw.header
          ? raw.header.vendorId
          : (raw.header as RawHeaderSnake).vendor_id,
        vendorName: 'vendorName' in raw.header
          ? (raw.header.vendorName ?? undefined)
          : ((raw.header as RawHeaderSnake).vendor_name ?? undefined),
        destinationId: 'destinationId' in raw.header
          ? raw.header.destinationId
          : (raw.header as RawHeaderSnake).destination_id,
        destinationName: 'destinationName' in raw.header
          ? (raw.header.destinationName ?? undefined)
          : ((raw.header as RawHeaderSnake).destination_name ?? undefined),
      }
    : undefined;

  // line 変換（camel / snake 両対応）
  const lines: VendorOrderLine[] = (raw.lines ?? []).map((x) => {
    const itemId = 'itemId' in x ? x.itemId : (x as RawLineSnake).item_id;
    const itemName = 'itemName' in x ? x.itemName : (x as RawLineSnake).item_name;
    const orderedQty = 'orderedQty' in x ? x.orderedQty : (x as RawLineSnake).ordered_qty;
    const shipQty = 'shipQty' in x ? x.shipQty : (x as RawLineSnake).ship_qty;
    const unitPrice = 'unitPrice' in x ? x.unitPrice : (x as RawLineSnake).unit_price;
    const tempZone = 'tempZone' in x ? x.tempZone : (x as RawLineSnake).temp_zone;
    const lotNo = 'lotNo' in x ? x.lotNo : (x as RawLineSnake).lot_no;
    const headerId = 'headerId' in x ? x.headerId : (x as RawLineSnake).shipment_id;

    return {
      lineId: String(('lineId' in x && x.lineId != null ? x.lineId : x.id)),
      headerId: String(headerId ?? id),
      itemId,
      itemName: itemName ?? '',
      orderedQty: Number(orderedQty ?? 0),
      shipQty: Number(shipQty ?? 0),
      unitPrice: Number(unitPrice ?? 0),
      amount: Number(('amount' in x ? x.amount : (x as RawLineSnake).amount) ?? 0),
      unit: ('unit' in x ? x.unit : (x as RawLineSnake).unit) ?? '',
      spec: ('spec' in x ? x.spec : (x as RawLineSnake).spec) ?? '',
      tempZone: tempZone ?? undefined,
      lotNo: lotNo ?? '',
      note: ('note' in x ? x.note : (x as RawLineSnake).note) ?? '',
    };
  });

  return { header, lines };
}

export async function createShipment(payload: {
  deliveryDate: string; vendorId: string; destinationId: string; destinationName?: string;
  lines: Array<Pick<VendorOrderLine,'itemId'|'itemName'|'unit'|'spec'|'tempZone'|'shipQty'|'note'|'lotNo'>>;
}) {
    const data = await postJson<{ ok: true; header: VendorOrderHeader }>("/shipments/create", payload);
  return { header: data.header as VendorOrderHeader };
}

export async function updateShipmentHeader(id: string, p: Partial<Pick<VendorOrderHeader,'deliveryDate'|'vendorId'|'destinationId'|'destinationName'|'status'>>) {
  await patchJson<unknown>(`/shipments/${id}`, p);
}

export async function saveLines(id: string, lines: VendorOrderLine[]) {
  await postJson<unknown>(`/shipments/${id}/lines/bulk`, lines);
}

// --- 追加: 出荷の一括確定/取消（サーバ側 /shipments/confirm, /shipments/unconfirm を想定） ---
export async function confirmShipments(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await postJson<unknown>("/shipments/confirm", { ids });
}

export async function unconfirmShipments(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await postJson<unknown>("/shipments/unconfirm", { ids });
}

// --- 追加: デモシード（今は何もしないNOOPでOK） ---
export async function seedDemoIfEmpty(): Promise<void> {
  // 必要になったら実装。現状は呼ばれても副作用なし。
}

// 先頭の型と同居
export type MasterItem = {
  id: string;
  name?: string | null;
  spec?: string | null;
  unit?: string | null;
  tempZone?: TempZone | null;
};

type RawItem = {
  id?: unknown; item_id?: unknown; code?: unknown;
  name?: unknown; item_name?: unknown;
  spec?: unknown; item_spec?: unknown;
  unit?: unknown;
  tempZone?: unknown; temp_zone?: unknown;
};

// TempZone の実体に合わせて列挙（必要なら増やしてください）
function isTempZone(v: unknown): v is TempZone {
  return v === 'ambient' || v === 'chilled' || v === 'frozen';
}

// 置換：既存の listItems() 全体
export async function listItems(): Promise<MasterItem[]> {
  const rows = await getJson<unknown[]>('/master/items');
  function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null;
  }

  const norm = (r: unknown): MasterItem | null => {
    if (!isRecord(r)) return null;

    const idRaw = r.id ?? r.item_id ?? r.code ?? null;
    if (typeof idRaw !== 'string') return null;

      const nameRaw = r.name ?? r.item_name ?? null;
      const specRaw = r.spec ?? r.item_spec ?? null;
      const unitRaw = r.unit ?? null;
      const tzRaw   = r.tempZone ?? r.temp_zone ?? null;

    return {
      id: idRaw,
      name: typeof nameRaw === 'string' ? nameRaw : null,
      spec: typeof specRaw === 'string' ? specRaw : null,
      unit: typeof unitRaw === 'string' ? unitRaw : null,
      // ← ここがポイント：TempZoneにマッチした時だけ代入、違えば null
      tempZone: isTempZone(tzRaw) ? tzRaw : null,
    };
  };
  return (Array.isArray(rows) ? rows : []).map(norm).filter(Boolean) as MasterItem[];
}


export async function deleteLine(headerId: string, itemId: string): Promise<void> {
  await fetch(url(`/shipments/${headerId}/lines/${itemId}`), { method: 'DELETE' });
}

export async function replaceLines(headerId: string, rows: VendorOrderLine[]): Promise<void> {
  await postJson(`/shipments/${encodeURIComponent(headerId)}/lines/replace`, {
    lines: rows.map(l => ({
      // itemId: ID.item(l.itemId),
      itemId: toItemId(l.itemId),
      orderedQty: Number(l.orderedQty ?? 0),
      shipQty: Number(l.shipQty ?? 0),
      unitPrice: Number(l.unitPrice ?? 0),
      amount: Number(l.amount ?? 0),
      unit: l.unit ?? '',
      spec: l.spec ?? '',
      tempZone: l.tempZone ?? null,
      lotNo: l.lotNo ?? '',
      note: l.note ?? '',
    })),
  });
}

export async function listStores(): Promise<MasterStore[]> {
  return await getJson<MasterStore[]>('/master/stores');
}

export async function listVendorItems(vendorId: string): Promise<MasterItem[]> {
  const vid = String(vendorId ?? '').replace(/\D/g, '').padStart(6, '0');
  const rows = await getJson<unknown>(`/master/vendors/${encodeURIComponent(vid)}/items`);
  const arr: RawItem[] = Array.isArray(rows) ? (rows as RawItem[]) : [];

  const out: MasterItem[] = [];
  for (const r of arr) {
    const idRaw = r.id ?? r.item_id ?? r.code;
    if (typeof idRaw !== 'string') continue;
    const nameRaw = r.name ?? r.item_name ?? null;
    const specRaw = r.spec ?? r.item_spec ?? null;
    const unitRaw = r.unit ?? null;
    const tzRaw   = r.tempZone ?? r.temp_zone ?? null;
    out.push({
      id: idRaw,
      name: (typeof nameRaw === 'string' ? nameRaw : null),
      spec: (typeof specRaw === 'string' ? specRaw : null),
      unit: (typeof unitRaw === 'string' ? unitRaw : null),
      tempZone: (typeof tzRaw === 'string' || tzRaw === null) ? (tzRaw as (TempZone|null)) : null,
    });
  }
  return out;
}

// 置換：/vendors 優先・/master/vendors フォールバック（any 不使用）
export async function listVendors(): Promise<MasterVendor[]> {
  // 1) /vendors … { vendors: [...] } 想定
  const r1 = await getJson<unknown>("/vendors").catch(() => undefined);
  if (isRecord(r1) && isArrayOfRecord(r1.vendors)) {
    const out: MasterVendor[] = [];
    for (const r of r1.vendors) {
      const idRaw   = r.id ?? r.vendor_id ?? r.code;
      const nameRaw = r.name ?? r.vendor_name ?? null;
      if (typeof idRaw !== "string") continue;

      // ★ 修正：name は必ず string にする
      const name = typeof nameRaw === "string" ? nameRaw : "";

      out.push({ id: idRaw, name });
    }
    return out;
  }

  // 2) /master/vendors … 配列想定
  const r2 = await getJson<unknown>("/master/vendors").catch(() => []);
  const arr = isArrayOfRecord(r2) ? r2 : [];
  const out: MasterVendor[] = [];
  for (const r of arr) {
    const idRaw   = r.id ?? r.vendor_id ?? r.code;
    const nameRaw = r.name ?? r.vendor_name ?? null;
    if (typeof idRaw !== "string") continue;

    // ★ 修正：こちらも必ず string
    const name = typeof nameRaw === "string" ? nameRaw : "";

    out.push({ id: idRaw, name });
  }
  return out;
}

// ==== 受注→出荷 一括生成 ====
export type GenerateShipmentsParams = {
  asOf?: string;          // 'YYYY-MM-DD HH:MM:SS'
  from?: string;          // 'YYYY-MM-DD'
  to?: string;            // 'YYYY-MM-DD'
  vendorId?: string;
  destinationId?: string;
  dryRun?: boolean;
};

// export type GenerateShipmentsResult = {
//   ok: boolean;
//   createdHeaders: number; // 生成された（または対象となった）ヘッダ件数
//   upsertedLines: number;  // 同じく明細件数
//   preview?: {
//     headers: number;
//     lines: number;
//   };
//   // ★ 生成対象となった shipment.id 一覧（/generate の時だけ）
//   generatedHeaderIds?: string[];
// };
export type GenerateShipmentsResult = {
  ok: boolean;

  // 既存フィールド
  createdHeaders?: number; // 純粋な「新規ヘッダ作成数」
  upsertedLines?: number;  // 明細の upsert 件数
  preview?: {
    headers: number;       // プレビュー対象ヘッダ数
    lines: number;         // プレビュー対象明細数
  };
  // 生成対象となった shipment.id 一覧（/generate の時だけ）
  generatedHeaderIds?: string[];

  // ★ バックエンドの追加フィールド（いずれも optional）
  countHeaders?: number;    // プレビュー時: 対象ヘッダ数
  countLines?: number;      // プレビュー時: 対象明細数
  headersAffected?: number; // 本処理時: 対象ヘッダ数（既存 + 新規）
  linesAffected?: number;   // 本処理時: 対象明細数
  skippedHeaders?: number;  // 確定済みでスキップされたヘッダ数
  skippedLines?: number;    // 確定済みでスキップされた明細数

  // エラー時メッセージ（あれば）
  error?: string;
};

// サーバ生レスポンス用の補助型（any を避けるため）
type RawGenerateShipmentsResponse = {
  ok?: boolean;
  error?: string;
  nowHHmm?: string;

  // プレビュー用
  countHeaders?: number;
  countLines?: number;

  // 本生成用
  headersAffected?: number;
  linesAffected?: number;

  // ★ 新規追加
  headerIds?: Array<number | string>;
};

type GenerateShipmentsPayload = {
  asOf?: string;
  from?: string;
  to?: string;
  vendorId?: string;
  destinationId?: string;
  dryRun?: boolean;
};

export async function generateShipments(
  params: GenerateShipmentsPayload
): Promise<GenerateShipmentsResult> {
  // dryRun によって呼ぶエンドポイントを切り替え
  const path = params.dryRun
    ? "/shipments/generate/preview"
    : "/shipments/generate";

  const raw = await postJson<RawGenerateShipmentsResponse>(path, {
    asOf: params.asOf,
    from: params.from,
    to: params.to,
    vendorId: params.vendorId,
    destinationId: params.destinationId,
    // /preview 側は dryRun は見ていないが、あっても害はない
    dryRun: params.dryRun ?? false,
  });

  if (raw.ok === false) {
    throw new Error(raw.error ?? "failed to generate shipments");
  }

  // ★ プレビュー呼び出し（/preview）
  if (params.dryRun) {
    const headers = raw.countHeaders ?? raw.headersAffected ?? 0;
    const lines = raw.countLines ?? raw.linesAffected ?? 0;

    return {
      ok: true,
      createdHeaders: headers,
      upsertedLines: lines,
      preview: {
        headers,
        lines,
      },
    };
  }

 // ★ 本生成呼び出し（/generate）
  const created = raw.headersAffected ?? raw.countHeaders ?? 0;
  const lines = raw.linesAffected ?? raw.countLines ?? 0;

  const generatedHeaderIds = Array.isArray(raw.headerIds)
    ? raw.headerIds
        .map((x) => String(x))
        .filter((s) => s !== "")
    : undefined;

  return {
    ok: true,
    createdHeaders: created,
    upsertedLines: lines,
    generatedHeaderIds,
  };
}