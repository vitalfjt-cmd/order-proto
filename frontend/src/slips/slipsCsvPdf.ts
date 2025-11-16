// src/slips/slipsCsvPdf.ts
import { toCsvString } from "../utils/csv";
import type { AdjustmentSlip } from "./slipsApi";

export function buildSlipsCsv(
  slips: AdjustmentSlip[],
  opts?: { includeHeader?: boolean; delimiter?: "," | "\t" }
): string {
  const withHeader = opts?.includeHeader ?? true;
  const delimiter = opts?.delimiter ?? ",";
  const rows: (string|number)[][] = [];
  if (withHeader) {
    rows.push(["伝票種別","納品日","ベンダーID","納品先ID","伝票ID","品目コード","品目名","数量","単位"]);
  }
  for (const s of slips) {
    for (const ln of s.lines) {
      rows.push([s.type, s.deliveryDate, s.vendorId, s.destinationId, s.id, ln.itemId, ln.itemName, ln.qty, ln.unit]);
    }
  }
  return toCsvString(rows, { delimiter });
}

export function openSlipsPrint(slips: AdjustmentSlip[]) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>赤黒伝票</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 16px; }
  .noprint { margin-bottom: 12px; }
  .slip { page-break-inside: avoid; margin-bottom: 20px; }
  .title { font-weight: 700; font-size: 16px; }
  .meta { color:#475569; font-size: 12px; margin-bottom: 6px; }
  table { width:100%; border-collapse: collapse; }
  th, td { border-bottom:1px solid #e2e8f0; padding:6px 8px; }
  th { background:#f8fafc; }
  .right { text-align:right; }
  @media print { .noprint { display:none } }
</style></head><body>
  <div class="noprint"><button onclick="window.print()">印刷</button></div>
  ${slips.map(s => `
    <div class="slip">
      <div class="title">伝票（${s.type}）</div>
      <div class="meta">伝票ID: ${s.id} ／ 納品日: ${s.deliveryDate} ／ ベンダー: ${s.vendorId} ／ 納品先: ${s.destinationId} ${s.destinationName ?? ""}</div>
      <table>
        <thead><tr><th>品目コード</th><th>品目名</th><th class="right">数量</th><th>単位</th></tr></thead>
        <tbody>
          ${s.lines.map(l => `<tr><td>${l.itemId}</td><td>${l.itemName}</td><td class="right">${l.qty}</td><td>${l.unit}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
  `).join("")}
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
}
