// src/inspection/discrepancyCsv.ts
import { toCsvString } from "../utils/csv";
import type { InspectionHeader, InspectionLine } from "./inspectionApi";

export function buildDiscrepancyCsv(
  headers: InspectionHeader[],
  lines: InspectionLine[],
  scope?: { headerIds?: string[]; includeHeader?: boolean; delimiter?: "," | "\t" }
): string {
  const withHeader = scope?.includeHeader ?? true;
  const delimiter = scope?.delimiter ?? ",";
  const target = scope?.headerIds ? new Set(scope.headerIds) : null;

  const hMap = new Map(headers.map(h => [h.id, h]));
  const rows: (string|number)[][] = [];

  if (withHeader) {
    rows.push([
      "納品日","ベンダーID","納品先ID","伝票ID",
      "品目コード","出荷数","検品数","差異","単位","ロット"
    ]);
  }

  for (const l of lines) {
    const h = hMap.get(l.headerId);
    if (!h) continue;
    if (target && !target.has(h.id)) continue;

    const diff = Number(l.inspectQty || 0) - Number(l.shipQty || 0);
    if (diff === 0) continue;

    rows.push([
      h.deliveryDate,
      h.vendorId,
      h.destinationId,
      h.id,
      l.itemId,
      Number(l.shipQty || 0),
      Number(l.inspectQty || 0),
      diff,
      l.unit,
      l.lotNo ?? "",
    ]);
  }

  return toCsvString(rows, { delimiter });
}
