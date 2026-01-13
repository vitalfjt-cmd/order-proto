// src/reports/pdf/pickingPdf.ts
import type { VendorOrderHeader, VendorOrderLine } from "../../vendor/apiVendor";

/** 並び順: 納品先ID → 温度帯 → 品目コード（CSVと揃える） */
function sortLines(headers: VendorOrderHeader[], lines: VendorOrderLine[]) {
  const hMap = new Map(headers.map(h => [h.id, h]));
  return [...lines].sort((a, b) => {
    const ha = hMap.get(a.headerId)!; const hb = hMap.get(b.headerId)!;
    if (ha.destinationId !== hb.destinationId) return ha.destinationId.localeCompare(hb.destinationId);
    const tzA = a.tempZone || "zzz"; const tzB = b.tempZone || "zzz";
    if (tzA !== tzB) return tzA.localeCompare(tzB);
    return a.itemId.localeCompare(b.itemId);
  });
}

export function openPickingPrint(headers: VendorOrderHeader[], lines: VendorOrderLine[]) {
  const sorted = sortLines(headers, lines).filter(l => (l.shipQty ?? 0) > 0);
  const hMap = new Map(headers.map(h => [h.id, h]));

  const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>ピッキングリスト</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 16px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  .meta { color:#475569; font-size: 12px; margin-bottom: 12px; }
  table { width:100%; border-collapse: collapse; }
  th, td { border-bottom:1px solid #e2e8f0; padding:6px 8px; }
  th { position: sticky; top: 0; background: white; }
  .right { text-align:right; }
  .grp { margin-top: 20px; }
  @media print {
    .noprint { display:none; }
    th { position: sticky; top: 0; background: white; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="noprint" style="margin-bottom:12px">
    <button onclick="window.print()">印刷</button>
  </div>
  <h1>ピッキングリスト</h1>
  <div class="meta">件数: ${headers.length}</div>
  <table>
    <thead>
      <tr>
        <th>納品日</th><th>ベンダー</th><th>納品先</th>
        <th>品目コード</th><th>品目名</th><th>規格</th><th>温度帯</th>
        <th class="right">出荷数量</th><th>単位</th><th>備考</th>
      </tr>
    </thead>
    <tbody>
      ${sorted.map(l => {
        const h = hMap.get(l.headerId)!;
        return `
          <tr>
            <td>${h.deliveryDate}</td>
            <td>${h.vendorId}</td>
            <td>${h.destinationId} ${h.destinationName ?? ""}</td>
            <td>${l.itemId}</td>
            <td>${l.itemName}</td>
            <td>${l.spec ?? ""}</td>
            <td>${l.tempZone ?? ""}</td>
            <td class="right">${l.shipQty}</td>
            <td>${l.unit}</td>
            <td>${l.note ?? ""}</td>
          </tr>
        `;
      }).join("")}
    </tbody>
  </table>
</body>
</html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
