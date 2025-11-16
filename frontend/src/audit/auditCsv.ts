// src/audit/auditCsv.ts
import type { AuditEvent } from "../auditlog";
import { toCsvString, downloadCsv } from "../utils/csv";

type Opts = {
  includeHeader?: boolean;
  delimiter?: "," | "\t";
};

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

  const data = rows.map(r => ([
    (r.at || "").replace("T", " ").replace("Z", ""),
    r.actor ?? "",
    r.type ?? "",
    r.headerId ?? "",
    r.destinationId ?? "",
    r.destinationName ?? "",     // ← 追加
    r.vendorId ?? "",
    r.deliveryDate ?? "",
    r.memo ?? "",
  ]));

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
