// src/audit/auditCsv.ts
import type { AuditEvent } from "../auditlog";
import { toCsvString, downloadCsv } from "../utils/csv";
import { AUDIT_EVENT_TYPE_LABEL, isAuditEventType } from "./auditCodes";

function getTypeLabel(type: string) {
  return isAuditEventType(type) ? AUDIT_EVENT_TYPE_LABEL[type] : type;
}

type Opts = {
  includeHeader?: boolean;
  delimiter?: "," | "\t";
};

 export function buildAuditCsv(rows: AuditEvent[], opts: Opts = {}): string {
   const { includeHeader = true, delimiter = "," } = opts;

   const header = [
     "日時",
     "ユーザー",
     "種別",
     "伝票番号",
     "検品ID",
     "納品先ID",
     "納品先名",
     "ベンダー",
     "納品日",
     "メモ",
   ];

   const data = rows.map(r => {
     const label = getTypeLabel(r.type);

     return [
       (r.at || "").replace("T", " ").replace("Z", ""),
       r.actor ?? "",
       label,
       r.shipmentId ?? "",
       r.inspectionId ?? "",
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
