// frontend/src/reports/csv/pickingCsv.ts
import { toCsvString } from "../../utils/csv";
import type { VendorOrderHeader, VendorOrderLine } from "../../vendor/apiVendor";

export function buildPickingCsv(
  headers: VendorOrderHeader[],
  lines: VendorOrderLine[],
  opts?: { includeHeader?: boolean; delimiter?: "," | "\t" }
) {
  const withHeader = opts?.includeHeader ?? true;
  const delimiter = opts?.delimiter ?? ",";

  const rows: (string | number)[][] = [];
  if (withHeader) {
    rows.push([
      "納品日",
      "ベンダーID",
      "納品先ID",
      "納品先名",
      "品目コード",
      "品目名",
      "規格",
      "温度帯",
      "受注数量",
      "出荷数量",
      "単位",
      "備考",
    ]);
  }

  // 並び: 納品先ID → 温度帯 → 品目コード
  const hMap = new Map(headers.map((h) => [h.id, h]));
  const sorted = [...lines].sort((a, b) => {
    const ha = hMap.get(a.headerId)!;
    const hb = hMap.get(b.headerId)!;
    if (ha.destinationId !== hb.destinationId) return ha.destinationId.localeCompare(hb.destinationId);
    const tzA = a.tempZone || "zzz";
    const tzB = b.tempZone || "zzz";
    if (tzA !== tzB) return tzA.localeCompare(tzB);
    return a.itemId.localeCompare(b.itemId);
  });

  for (const ln of sorted) {
    const h = hMap.get(ln.headerId)!;
    if ((ln.shipQty ?? 0) === 0) continue; // 0は出さない
    rows.push([
      h.deliveryDate,
      h.vendorId,
      h.destinationId,
      h.destinationName ?? "",
      ln.itemId,
      ln.itemName,
      ln.spec ?? "",
      ln.tempZone ?? "",
      ln.orderedQty,
      ln.shipQty,
      ln.unit,
      ln.note ?? "",
    ]);
  }

  return toCsvString(rows, { delimiter });
}
