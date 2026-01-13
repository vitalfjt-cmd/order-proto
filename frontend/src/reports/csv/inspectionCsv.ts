// frontend/src/reports/csv/inspectionCsv.ts
import { toCsvString } from "../../utils/csv";
import type { VendorOrderHeader, VendorOrderLine } from "../../vendor/apiVendor";

/** 伝票No（暫定）：納品日-納品先ID-ベンダーID */
function buildSlipNo(h: VendorOrderHeader): string {
  return `${h.deliveryDate}-${h.destinationId}-${h.vendorId}`;
}

/**
 * 検品CSV（ダミー拡張）
 * 列：出荷ID, 伝票No, 納品日, ベンダーID, 納品先ID, 品目コード, 出荷数量, 検品数量, 単位, ロット, 生成時刻
 * - shipQty>0 の行のみ
 * - headerIds で指定した伝票のみを対象
 * - 現時点の検品数量は shipQty と同値（後続で検品入力に置換）
 */
export function buildInspectionCsv(
  headers: VendorOrderHeader[],
  lines: VendorOrderLine[],
  headerIds: string[],
  opts?: { includeHeader?: boolean; delimiter?: "," | "\t" }
): string {
  const withHeader = opts?.includeHeader ?? true;
  const delimiter = opts?.delimiter ?? ",";
  const nowIso = new Date().toISOString(); // タイムスタンプなのでUTCでOK

  const hMap = new Map(headers.map((h) => [h.id, h]));
  const allow = new Set(headerIds);

  const rows: (string | number)[][] = [];
  if (withHeader) {
    rows.push([
      "出荷ID",
      "伝票No",
      "納品日",
      "ベンダーID",
      "納品先ID",
      "品目コード",
      "出荷数量",
      "検品数量",
      "単位",
      "ロット",
      "生成時刻",
    ]);
  }

  for (const ln of lines) {
    if ((ln.shipQty ?? 0) <= 0) continue;
    const h = hMap.get(ln.headerId);
    if (!h || !allow.has(h.id)) continue;

    const slipNo = buildSlipNo(h);
    const inspectQty = ln.shipQty; // 現状は同値。将来は検品入力値へ置換

    rows.push([
      h.id, // 出荷ID
      slipNo,
      h.deliveryDate,
      h.vendorId,
      h.destinationId,
      ln.itemId,
      ln.shipQty,
      inspectQty,
      ln.unit,
      ln.lotNo ?? "",
      nowIso,
    ]);
  }

  return toCsvString(rows, { delimiter });
}
