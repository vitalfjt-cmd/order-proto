// frontend/src/auditlog.ts

export type AuditEventType =
  | "shipment.confirm"         // 出荷確定
  | "shipment.unconfirm"       // 出荷確定の取消（モック）
  | "shipment.save"            // 出荷ヘッダ/明細の保存
  | "inspection.confirm"       // 検収（検品）確定
  | "inspection.unconfirm"     // 検収の取消（モック）
  | "inspection.save"          // 検品内容の保存
  | "inspection.audit";        // 検品監査完了

export interface AuditEvent {
  id: string;                  // UUID的な一意ID
  at: string;                  // ISO文字列
  actor: string;               // 実行ユーザーID（暫定）
  type: AuditEventType;
  // 関連キー（任意で null 可）
  shipmentId?: string | null; 
  inspectionId?: string | null; 
  ownerId?: string | null;     // 所有主体（S001/DC01/VND01等）
  vendorId?: string | null;
  destinationId?: string | null;
  // 店舗名
  destinationName?: string | null;
  deliveryDate?: string | null;
  // 参考情報（自由記述）
  memo?: string | null;
}

// ===== 共通ヘルパー（HTTP） =====

async function getJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    credentials: "same-origin",
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

// UUID v4 もどき
function uuid4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 暫定の実行ユーザー（ログイン導入までのモック） */
export function currentActor(): string {
  // 例: 管理者: "mgr001" / ベンダー: "v-ops" / DC: "dc-ops"
  return localStorage.getItem("CURRENT_ACTOR") || "user";
}

/** 1件追加（非同期だが await なしで呼んでもOK） */
export function logEvent(
  p: Omit<AuditEvent, "id" | "at" | "actor"> & { actor?: string }
): void {
  const now = new Date().toISOString();
  const ev: AuditEvent = {
    id: uuid4(),
    at: now,
    actor: p.actor ?? currentActor(),
    type: p.type,
    shipmentId: p.shipmentId ?? null,
    inspectionId: p.inspectionId ?? null,
    ownerId: p.ownerId ?? null,
    vendorId: p.vendorId ?? null,
    destinationId: p.destinationId ?? null,
    destinationName: p.destinationName ?? null,
    deliveryDate: p.deliveryDate ?? null,
    memo: p.memo ?? null,
  };

  // fire-and-forget でサーバーに送る
  void getJson<{ ok: boolean }>("/audit/events", {
    method: "POST",
    body: JSON.stringify(ev),
    headers: { "Content-Type": "application/json" },
  }).catch((e) => {
    console.error("[auditlog] failed to send event", e);
  });
}

// ===== 検索 =====

export type SearchAuditOptions = {
  dateFrom?: string;     // YYYY-MM-DD
  dateTo?: string;       // YYYY-MM-DD
  actor?: string;
  type?: AuditEventType;
  shipmentId?: string;
  inspectionId?: string;
  vendorId?: string;
  destinationId?: string;
};

/** サーバー上の audit_logs を検索 */
export async function searchAudit(
  opts: SearchAuditOptions = {}
): Promise<AuditEvent[]> {
  const qs = new URLSearchParams();
  if (opts.dateFrom) qs.set("dateFrom", opts.dateFrom);
  if (opts.dateTo) qs.set("dateTo", opts.dateTo);
  if (opts.actor) qs.set("actor", opts.actor);
  if (opts.type) qs.set("type", opts.type);
  if (opts.shipmentId) qs.set("shipmentId", opts.shipmentId);
  if (opts.inspectionId) qs.set('inspectionId', opts.inspectionId);
  if (opts.vendorId) qs.set("vendorId", opts.vendorId);
  if (opts.destinationId) qs.set("destinationId", opts.destinationId);

  const url = qs.toString() ? `/audit/events?${qs.toString()}` : "/audit/events";
  const list = await getJson<AuditEvent[]>(url);
  // 念のためクライアント側でも新しい順に揃える
  return list.sort((a, b) => b.at.localeCompare(a.at));
}
