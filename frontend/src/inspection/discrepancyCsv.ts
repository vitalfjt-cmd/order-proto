// src/inspection/discrepancyCsv.ts
import { toCsvString } from "../utils/csv";
import type { InspectionHeader, InspectionLine } from "./inspectionApi";

export function buildDiscrepancyCsv(
  headers: InspectionHeader[],
  lines: InspectionLine[],
  scope?: {
    headerIds?: string[];
    includeHeader?: boolean;
    delimiter?: "," | "\t";
  }
): string {
  const withHeader = scope?.includeHeader ?? true;
  const delimiter = scope?.delimiter ?? ",";

  // 選択した検品IDのみ対象（なければ全件）
  const targetHeaderIds = scope?.headerIds
    ? new Set(scope.headerIds)
    : null;

  // id → header
  const hMap = new Map<number, InspectionHeader>(
    headers.map((h) => [h.id, h])
  );

  const rows: (string | number)[][] = [];

  // ★ ヘッダ行（列を分割 & 品目名を追加）
  if (withHeader) {
    rows.push([
      "検品ID",
      "納品日",
      "ベンダーID",
      "納品先ID",
      "納品先名称",
      "品目コード",
      "品目名称",
      "出荷数",
      "検品数",
      "差異数量",
      "単位",
      "ロット",
      "備考",
    ]);
  }

  for (const l of lines) {
    const h = hMap.get(l.inspectionId);
    if (!h) continue;

    // 指定ヘッダでの絞り込み
    if (targetHeaderIds && !targetHeaderIds.has(String(h.id))) {
      continue;
    }

    const diff = Number(l.diffQty ?? 0);
    if (diff === 0) continue;

    rows.push([
      h.id,
      h.deliveryDate,
      h.vendorId,
      h.destinationId,
      h.destinationName ?? "",
      l.itemId,
      l.itemName ?? "",          // ★ 品目名称
      Number(l.shipQty ?? 0),
      Number(l.inspectedQty ?? 0),
      diff,
      l.unit ?? "",
      l.lotNo ?? "",
      l.note ?? "",
    ]);
  }

  return toCsvString(rows, { delimiter });
}
