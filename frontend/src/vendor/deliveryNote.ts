// src/vendor/deliveryNote.ts
import type { VendorOrderHeader, VendorOrderLine } from "./apiVendor";

export function openDeliveryNotePrint(header: VendorOrderHeader, lines: VendorOrderLine[]) {
  const rows = lines.filter(l => (l.shipQty ?? 0) > 0);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>納品書 ${header.deliveryDate}-${header.destinationId}-${header.vendorId}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 16px; }
  .head { display:flex; justify-content:space-between; margin-bottom:12px; }
  .h1 { font-size:18px; font-weight:700; }
  .meta { color:#475569; font-size:12px; }
  table { width:100%; border-collapse:collapse; }
  th, td { border-bottom:1px solid #e2e8f0; padding:6px 8px; }
  th { background:#f8fafc; }
  .right { text-align:right; }
  .foot { margin-top:12px; display:flex; justify-content:flex-end; gap:24px; }
  @media print { .noprint { display:none } }
</style></head>
<body>
  <div class="noprint" style="margin-bottom:8px"><button onclick="window.print()">印刷</button></div>
  <div class="head">
    <div class="h1">納品書</div>
    <div class="meta">
      伝票No: ${header.deliveryDate}-${header.destinationId}-${header.vendorId}<br/>
      納品日: ${header.deliveryDate}
    </div>
  </div>
  <div class="meta" style="margin-bottom:8px">
    ベンダー: ${header.vendorId} ／ 納品先: ${header.destinationId} ${header.destinationName ?? ""}
  </div>
  <table>
    <thead>
      <tr>
        <th>品目コード</th><th>品目名</th><th>規格</th>
        <th class="right">数量</th><th>単位</th><th>備考</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(r => `
      <tr>
        <td>${r.itemId}</td><td>${r.itemName}</td><td>${r.spec ?? ""}</td>
        <td class="right">${r.shipQty}</td><td>${r.unit}</td><td>${r.note ?? ""}</td>
      </tr>`).join("")}
    </tbody>
  </table>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
}
