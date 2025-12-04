// src/auditlog.ts
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
  headerId?: string | null;    // 伝票番号（VOH-...）
  ownerId?: string | null;     // 所有主体（S001/DC01/VND01等）
  vendorId?: string | null;
  destinationId?: string | null;
  // 店舗名
  destinationName?: string | null;
  deliveryDate?: string | null;
  // 参考情報（自由記述）
  memo?: string | null;
}

const STORAGE_KEY = "AUDIT_LOG_V1";

function loadAll(): AuditEvent[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as AuditEvent[]; } catch { return []; }
}

function saveAll(list: AuditEvent[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function uuid4(): string {
  // 簡易UUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random()*16)|0, v = c === "x" ? r : (r&0x3)|0x8;
    return v.toString(16);
  });
}

/** 暫定の実行ユーザー（ログイン導入までのモック） */
export function currentActor(): string {
  // 例: 管理者: "mgr001" / ベンダー: "v-ops" / DC: "dc-ops"
  return localStorage.getItem("CURRENT_ACTOR") || "user";
}

/** 1件追加 */
export function logEvent(p: Omit<AuditEvent, "id" | "at" | "actor"> & { actor?: string }) {
  const now = new Date().toISOString();
  const ev: AuditEvent = {
    id: uuid4(),
    at: now,
    actor: p.actor ?? currentActor(),
    type: p.type,
    headerId: p.headerId ?? null,
    ownerId: p.ownerId ?? null,
    vendorId: p.vendorId ?? null,
    destinationId: p.destinationId ?? null,
    destinationName: p.destinationName ?? null,
    deliveryDate: p.deliveryDate ?? null,
    memo: p.memo ?? null,
  };
  const all = loadAll();
  all.push(ev);
  saveAll(all);
}

/** 絞り込み検索 */
export function searchAudit(opts: {
  dateFrom?: string;     // YYYY-MM-DD
  dateTo?: string;       // YYYY-MM-DD
  actor?: string;
  type?: AuditEventType;
  headerId?: string;
  vendorId?: string;
  destinationId?: string;
} = {}): AuditEvent[] {
  const all = loadAll();
  return all.filter(ev => {
    if (opts.actor && ev.actor !== opts.actor) return false;
    if (opts.type && ev.type !== opts.type) return false;
    if (opts.headerId && ev.headerId !== opts.headerId) return false;
    if (opts.vendorId && ev.vendorId !== opts.vendorId) return false;
    if (opts.destinationId && ev.destinationId !== opts.destinationId) return false;

    if (opts.dateFrom || opts.dateTo) {
      const d = ev.at.slice(0,10);
      if (opts.dateFrom && d < opts.dateFrom) return false;
      if (opts.dateTo && d > opts.dateTo) return false;
    }
    return true;
  }).sort((a,b) => b.at.localeCompare(a.at)); // 新しい順
}

/** 全削除（運用中は使わない想定。テスト用） */
export function clearAudit() {
  localStorage.removeItem(STORAGE_KEY);
}
