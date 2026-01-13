// --- API raw types (from backend v_* views) -----------------
export type ApiShipmentHeader = {
  id: number | string;
  orderDate: string;
  deliveryDate: string;
  status: "open" | "confirmed" | "canceled";
  vendorId: string;
  vendorName?: string | null;
  destinationId: string;
  destinationName?: string | null;
};

export type ApiShipmentLine = {
  id: number | string;
  headerId?: number | string;

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

type ShipmentStatus = "open" | "confirmed" | "canceled";
type TempZone = "ambient" | "chilled" | "frozen";

function isShipmentStatus(v: unknown): v is ShipmentStatus {
  return v === "open" || v === "confirmed" || v === "canceled";
}

function isTempZone(v: unknown): v is TempZone {
  return v === "ambient" || v === "chilled" || v === "frozen";
}

function toShipmentStatus(v: unknown): ShipmentStatus {
  // ここは “不正値は落とす” のが気持ち悪さゼロ
  if (!isShipmentStatus(v)) throw new Error(`invalid shipment status: ${String(v)}`);
  return v;
}

function toTempZoneOrUndef(v: unknown): TempZone | undefined {
  if (v == null || v === "") return undefined;
  if (!isTempZone(v)) throw new Error(`invalid tempZone: ${String(v)}`);
  return v;
}

export type GetShipmentResponse = {
  header?: {
    id: number | string;
    orderDate: string;
    deliveryDate: string;
    status: string;
    vendorId: string;
    vendorName?: string | null;
    destinationId: string;
    destinationName?: string | null;
  };
  lines?: Array<{
    id?: number;
    lineId?: number;
    headerId?: number | string;
    itemId?: string;
    itemName?: string | null;
    orderedQty?: number;
    shipQty?: number;
    unitPrice?: number | null;
    amount?: number | null;
    unit?: string | null;
    spec?: string | null;
    tempZone?: string | null;
    lotNo?: string | null;
    note?: string | null;
  }>;
};

export type MasterStore = { id: string; name?: string | null };

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const url = (path: string, q?: Record<string, string | undefined>) => {
  const u = new URL(path.replace(/^\//, ""), API_BASE || window.location.origin);
  if (q) for (const [k, v] of Object.entries(q)) if (v != null && v !== "") u.searchParams.set(k, v);
  return u.toString();
};

// --- 追加: HTTP エラーを status + body 付きで扱う ---
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

export function isApiHttpError(e: unknown): e is ApiHttpError {
  return (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    "statusText" in e &&
    "body" in e
  );
}

async function readErrorBody(r: Response): Promise<unknown> {
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  // JSON が返るなら JSON を読む（今回の 409 はこれが欲しい）
  if (ct.includes("application/json")) {
    try {
      return await r.json() as unknown;
    } catch {
      return null;
    }
  }
  // JSON 以外なら text を読む（たまに HTML/空 が来るため）
  try {
    const t = await r.text();
    return t ? ({ message: t } as unknown) : null;
  } catch {
    return null;
  }
}

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
  if (!r.ok) {
    const body = await readErrorBody(r);
    throw new ApiHttpError(r.status, r.statusText, body);
  }
  return (await r.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(url(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errBody = await readErrorBody(r);
    throw new ApiHttpError(r.status, r.statusText, errBody);
  }
  return (await r.json()) as T;
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(url(path), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errBody = await readErrorBody(r);
    throw new ApiHttpError(r.status, r.statusText, errBody);
  }
  return (await r.json()) as T;
}

// 一覧＋明細まとめ取得（ピッキングなどで使う）
export async function searchShipments(params: {
  dateFrom?: string;
  dateTo?: string;
  vendorId?: string;
  destinationId?: string;
  headerId?: string;
}) {
  const headers = await getJson<ApiShipmentHeader[]>("/shipments", {
    from: params.dateFrom,
    to: params.dateTo,
    vendorId: params.vendorId,
    destinationId: params.destinationId,
    headerId: params.headerId,
  });

  const lines: VendorOrderLine[] = [];
  for (const h of headers) {
    const ls = await getJson<ApiShipmentLine[]>(`/shipments/${h.id}/lines`);
    lines.push(
      ...ls.map(
        (x): VendorOrderLine => ({
          lineId: String(x.id),
          headerId: String(h.id),
          itemId: x.itemId,
          itemName: x.itemName ?? "",
          orderedQty: Number(x.orderedQty ?? 0),
          shipQty: Number(x.shipQty ?? 0),
          unitPrice: Number(x.unitPrice ?? 0),
          amount: Number(x.amount ?? 0),
          unit: x.unit ?? "",
          spec: x.spec ?? "",
          tempZone: (x.tempZone ?? undefined),
          lotNo: x.lotNo ?? "",
          note: x.note ?? "",
        })
      )
    );
  }

  return {
    headers: headers.map(
      (h): VendorOrderHeader => ({
        id: String(h.id),
        orderDate: h.orderDate,
        deliveryDate: h.deliveryDate,
        status: h.status, // すでに union 型なのでそのままOK
        vendorId: h.vendorId,
        vendorName: h.vendorName ?? undefined,
        destinationId: h.destinationId,
        destinationName: h.destinationName ?? undefined,
      })
    ),
    lines,
  };
}

export async function getShipment(id: string) {
  const raw = await getJson<unknown>(`/shipments/${id}`);

  if (typeof raw !== "object" || raw == null) {
    throw new Error("invalid response: not an object");
  }
  const r = raw as Record<string, unknown>;

  // header
  const rawHeader = r["header"];
  const header: VendorOrderHeader | undefined =
    typeof rawHeader === "object" && rawHeader != null
      ? (() => {
          const h = rawHeader as Record<string, unknown>;
          return {
            id: String(h["id"]),
            orderDate: String(h["orderDate"] ?? ""),
            deliveryDate: String(h["deliveryDate"] ?? ""),
            status: toShipmentStatus(h["status"]),
            vendorId: String(h["vendorId"] ?? ""),
            vendorName: (h["vendorName"] ?? undefined) as string | undefined,
            destinationId: String(h["destinationId"] ?? ""),
            destinationName: (h["destinationName"] ?? undefined) as string | undefined,
          };
        })()
      : undefined;

  // lines
  const rawLines = r["lines"];
  const arr: unknown[] = Array.isArray(rawLines) ? rawLines : [];

  const lines: VendorOrderLine[] = arr.map((u) => {
    const x =
      typeof u === "object" && u != null ? (u as Record<string, unknown>) : ({} as Record<string, unknown>);

    return {
      lineId: String((x["lineId"] ?? x["id"]) as unknown),
      headerId: String((x["headerId"] ?? id) as unknown),
      itemId: String(x["itemId"] ?? ""),
      itemName: String(x["itemName"] ?? ""),
      orderedQty: Number(x["orderedQty"] ?? 0),
      shipQty: Number(x["shipQty"] ?? 0),
      unitPrice: Number(x["unitPrice"] ?? 0),
      amount: Number(x["amount"] ?? 0),
      unit: String(x["unit"] ?? ""),
      spec: String(x["spec"] ?? ""),
      tempZone: toTempZoneOrUndef(x["tempZone"]),
      lotNo: String(x["lotNo"] ?? ""),
      note: String(x["note"] ?? ""),
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
  id?: unknown;
  code?: unknown;  // もし code を返す仕様が残るなら残す
  name?: unknown;
  spec?: unknown;
  unit?: unknown;
  tempZone?: unknown;
};


export async function deleteLine(headerId: string, itemId: string): Promise<void> {
  await fetch(url(`/shipments/${headerId}/lines/${itemId}`), { method: 'DELETE' });
}

export async function replaceLines(headerId: string, rows: VendorOrderLine[]): Promise<void> {
  await postJson(`/shipments/${encodeURIComponent(headerId)}/lines/replace`, {
    lines: rows.map(l => ({
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
    const idRaw = r.id ?? r.code;
    if (typeof idRaw !== 'string') continue;
    const nameRaw = r.name ?? null;
    const specRaw = r.spec ?? null;
    const unitRaw = r.unit ?? null;
    const tzRaw = r.tempZone ?? null;
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
      const idRaw   = r.id ?? r.code;
      const nameRaw = r.name ?? null;
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
    const idRaw   = r.id ?? r.code;
    const nameRaw = r.name ?? null;
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
  reasons?: GenerateShipmentsReasons; // ★追加

  // エラー時メッセージ（あれば）
  error?: string;
};

export type GenerateShipmentsReasons = {
  totalBaseLines?: number;
  passedLines?: number;
  excludedNotOrderable?: number;
  excludedBeforeCutoff?: number;
  missingUnitPrice?: number;
  missingCutoffHHmm?: number;
  missingOrderable?: number;
};


type RawGenerateShipmentsResponse = {
  ok?: boolean;
  error?: string;
  nowHHmm?: string;

  // プレビュー用
  countHeaders?: number;      // 対象ヘッダ数
  countLines?: number;        // 対象明細数

  // 本生成用
  headersAffected?: number;   // 対象ヘッダ数（既存 + 新規）
  linesAffected?: number;     // 対象明細数

  // 確定済みでスキップされた件数
  skippedHeaders?: number;
  skippedLines?: number;

  // 新規ヘッダ / upsert 明細数（/generate のときだけ入る）
  createdHeaders?: number;
  upsertedLines?: number;

  // 生成された shipment.id 一覧
  headerIds?: Array<number | string>;
  reasons?: GenerateShipmentsReasons;
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
    const countHeaders = raw.countHeaders ?? raw.headersAffected ?? 0;
    const countLines = raw.countLines ?? raw.linesAffected ?? 0;
    const headersAffected = raw.headersAffected ?? countHeaders;
    const linesAffected = raw.linesAffected ?? countLines;
    const skippedHeaders = raw.skippedHeaders ?? 0;
    const skippedLines = raw.skippedLines ?? 0;

    return {
      ok: true,
      // プレビュー時は「created = 対象ヘッダ数」「upsertedLines = 対象明細数」とみなす
      createdHeaders: raw.createdHeaders ?? countHeaders,
      upsertedLines: raw.upsertedLines ?? countLines,

      // 呼び出し元（VendorShipments）が見るフィールド一式
      countHeaders,
      countLines,
      headersAffected,
      linesAffected,
      skippedHeaders,
      skippedLines,
      reasons: raw.reasons,
      preview: {
        headers: countHeaders,
        lines: countLines,
      },
    };
  }

  // ★ 本生成呼び出し（/generate）
  const countHeaders = raw.countHeaders ?? raw.headersAffected ?? 0;
  const countLines = raw.countLines ?? raw.linesAffected ?? 0;
  const headersAffected = raw.headersAffected ?? countHeaders;
  const linesAffected = raw.linesAffected ?? countLines;

  const created = raw.createdHeaders ?? 0;          // 純粋な「新規ヘッダ数」
  const upsertedLines = raw.upsertedLines ?? linesAffected;

  const skippedHeaders = raw.skippedHeaders ?? 0;
  const skippedLines = raw.skippedLines ?? 0;

  const generatedHeaderIds = Array.isArray(raw.headerIds)
    ? raw.headerIds.map((x) => String(x)).filter((s) => s !== "")
    : undefined;

  return {
    ok: true,

    // 既存フィールド
    createdHeaders: created,
    upsertedLines,

    // VendorShipments から参照される追加フィールド
    countHeaders,
    countLines,
    headersAffected,
    linesAffected,
    skippedHeaders,
    skippedLines,
    reasons: raw.reasons,
    generatedHeaderIds,
  };

}