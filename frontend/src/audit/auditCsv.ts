// src/audit/auditCsv.ts
import type { AuditEvent, AuditEventType } from "../auditlog";
import { toCsvString, downloadCsv } from "../utils/csv";


type Opts = {
  includeHeader?: boolean;
  delimiter?: "," | "\t";
};

// src/audit/auditCsv.ts

const TYPE_LABEL: Record<AuditEventType, string> = {
  "shipment.confirm":   "出荷確定",
  "shipment.unconfirm": "出荷確定取消",
  "shipment.save":      "出荷保存",
  "inspection.confirm": "検収確定",
  "inspection.unconfirm": "検収取消",
  "inspection.save":    "検品保存",
  "inspection.audit":   "検品監査",    // ★ 監査ラベルを追加
};

// 文字列が AuditEventType かどうか判定する型ガード
function isAuditEventType(t: string): t is AuditEventType {
  return t in TYPE_LABEL;
}

// AuditEvent の type からラベル文字列を返すヘルパー
function getTypeLabel(type: AuditEvent["type"]): string {
  if (!type) return "";
  if (isAuditEventType(type)) {
    return TYPE_LABEL[type];
  }
  // 想定外の type は生の文字列をそのまま返す
  return type;
}

export function buildAuditCsv(rows: AuditEvent[], opts: Opts = {}): string {
  const { includeHeader = true, delimiter = "," } = opts;

  // ★「納品先名」を追加（見出し8→9列に）
  const header = [
    "日時",
    "ユーザー",
    "種別",
    "伝票番号",
    "納品先ID",
    "納品先名",        // ← 追加
    "ベンダー",
    "納品日",
    "メモ",
  ];

  const data = rows.map(r => {
    const label = getTypeLabel(r.type);

    return [
      (r.at || "").replace("T", " ").replace("Z", ""),
      r.actor ?? "",
      label,                 // ★ ここがラベル
      r.headerId ?? "",
      r.destinationId ?? "",
      r.destinationName ?? "",
      r.vendorId ?? "",
      r.deliveryDate ?? "",
      r.memo ?? "",
    ];
  });

  const rows2 = includeHeader ? [header, ...data] : data;
  return toCsvString(rows2, { delimiter });
}

export function downloadAuditCsv(
  rows: AuditEvent[],
  opts: Opts & { filename?: string } = {}
) {
  const { filename, ...rest } = opts;
  const csv = buildAuditCsv(rows, rest);
  const name = filename ?? `audit_${new Date().toISOString().slice(0,19).replace(/[:T]/g,"")}.csv`;
  downloadCsv(name, csv);
}
