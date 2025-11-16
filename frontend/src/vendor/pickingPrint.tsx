// src/vendor/pickingPrint.tsx
import React from "react";
import type { VendorOrderHeader, VendorOrderLine, TempZone } from "./apiVendor";

/** ユーティリティ */
function esc(s: string | null | undefined): string {
  const t = s ?? "";
  return t.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]!));
}
function nf0(n: number) { return new Intl.NumberFormat("ja-JP").format(n); }

type GroupInput = { header: VendorOrderHeader; lines: VendorOrderLine[] };

/** 店舗別内訳を含む品目行 */
type PickDetailRow = {
  itemId: string;
  itemName: string;
  unit: string;
  spec: string;
  tempZone?: TempZone;
  // 店舗別の数量内訳
  stores: Array<{ destinationId: string; destinationName?: string; qty: number }>;
  totalQty: number;
};

/**
 * ピッキングリスト（店舗内訳つき）
 * - 選択した伝票をまとめ、温度帯→品目コード順で出力
 * - 各品目の下に「店舗ごとの数量内訳」を表示
 */
export function openPickingPrintWithStores(groups: GroupInput[]) {
  const win = window.open("", "_blank");
  if (!win) { alert("ポップアップがブロックされました。"); return; }

  const style = `
  <style>
    @media print {
      @page { size: A4; margin: 10mm; }
      .page { page-break-after: always; }
      .page:last-child { page-break-after: auto; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP",
                   "Yu Gothic UI", Roboto, Arial, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif;
      color:#111;
    }
    h1 { font-size: 18px; margin: 0 0 6px; }
    .meta { font-size:12px; color:#374151; margin-bottom: 8px; display:flex; flex-wrap:wrap; gap:12px; }
    table { width:100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border:1px solid #e5e7eb; padding:4px 6px; }
    th { background:#f8fafc; text-align:left; font-size: 12px; }
    td { font-size: 12px; }
    td.num, th.num { text-align:right; font-variant-numeric: tabular-nums; }
    .w-code { width: 100px; }
    .w-name { width: auto; }
    .w-unit { width: 60px; }
    .w-qty  { width: 90px; }
    .section { margin: 8px 0 4px; font-weight: 700; }
    .muted { color:#64748b; }
    .subtable { width:100%; border-collapse: collapse; margin-top: 2px; }
    .subtable th, .subtable td { border: 1px dashed #e5e7eb; padding: 3px 6px; font-size: 11px; }
    .subtable th { background: #fafafa; }
    .row-total { background:#f9fafb; font-weight:700; }
    .footer-note { color:#64748b; font-size:11px; margin-top:4px; }
  </style>`;

  // 条件表記（納品日・ベンダー）は、選択伝票から代表値を出す
  const uniq = <T,>(arr: T[]) => Array.from(new Set(arr));
  const deliveryDates = uniq(groups.map(g => g.header.deliveryDate)).sort();
  const vendorIds = uniq(groups.map(g => g.header.vendorId));

  // 品目ごとに「店舗内訳」を集計
  const map = new Map<string, PickDetailRow>();
  for (const g of groups) {
    for (const l of g.lines) {
      const key = l.itemId || "";
      if (!key) continue;
      const qty = Number(l.shipQty) || 0;
      if (qty === 0) continue; // 0は除外（必要なら含めてもOK）

      const destId = g.header.destinationId;
      const destName = g.header.destinationName;

      const found = map.get(key);
      if (found) {
        const store = found.stores.find(s => s.destinationId === destId);
        if (store) store.qty += qty;
        else found.stores.push({ destinationId: destId, destinationName: destName, qty });
        found.totalQty += qty;
      } else {
        map.set(key, {
          itemId: l.itemId || "",
          itemName: l.itemName || "",
          unit: l.unit || "",
          spec: l.spec || "",
          tempZone: l.tempZone,
          stores: [{ destinationId: destId, destinationName: destName, qty }],
          totalQty: qty,
        });
      }
    }
  }

  // 並び：温度帯（常温→チルド→冷凍）→ 品目コード
  const zoneOrder: TempZone[] = ["ambient","chilled","frozen"];
  const rows = Array.from(map.values()).sort((a,b) => {
    const za = zoneOrder.indexOf(a.tempZone ?? "ambient");
    const zb = zoneOrder.indexOf(b.tempZone ?? "ambient");
    if (za !== zb) return za - zb;
    return a.itemId.localeCompare(b.itemId);
  });

  // 温度帯でグルーピング
  const byZone: Record<string, PickDetailRow[]> = {};
  for (const r of rows) {
    const k = r.tempZone ?? "ambient";
    (byZone[k] ||= []).push(r);
  }
  const zoneJp: Record<string,string> = { ambient:"常温", chilled:"チルド", frozen:"冷凍" };

  const now = new Date();
  const nowStr =
    `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,"0")}/${String(now.getDate()).padStart(2,"0")} ` +
    `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;

  const html = `
  <!doctype html>
  <html lang="ja"><head><meta charset="utf-8"><title>ピッキングリスト（店舗内訳）</title>${style}</head>
  <body>
    <div class="page">
      <h1>ピッキングリスト（店舗内訳）</h1>
      <div class="meta">
        <div>納品日：${esc(deliveryDates.length === 1 ? deliveryDates[0] : `${deliveryDates[0]} ～ ${deliveryDates[deliveryDates.length-1]}`)}</div>
        <div>ベンダー：${esc(vendorIds.length === 1 ? vendorIds[0] : vendorIds.join(", "))}</div>
        <div>対象伝票数：${groups.length}</div>
        <div>発行：${nowStr}</div>
      </div>

      ${(["ambient","chilled","frozen"] as const).map(k => {
        const xs = byZone[k] || [];
        if (xs.length === 0) return "";
        return `
          <div class="section">${esc(zoneJp[k])}（${xs.length}品目）</div>
          <table>
            <colgroup>
              <col class="w-code" />
              <col class="w-name" />
              <col class="w-unit" />
              <col class="w-qty" />
            </colgroup>
            <thead>
              <tr>
                <th>品目コード</th>
                <th>品目名</th>
                <th>単位</th>
                <th class="num">合計数量</th>
              </tr>
            </thead>
            <tbody>
              ${xs.map(r => {
                const storesSorted = [...r.stores].sort((a,b) => a.destinationId.localeCompare(b.destinationId));
                const storesHtml = `
                  <table class="subtable">
                    <thead>
                      <tr>
                        <th style="width: 160px;">納品先</th>
                        <th class="num" style="width: 90px;">数量</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${storesSorted.map(s => `
                        <tr>
                          <td>${esc(s.destinationId)} ${esc(s.destinationName)}</td>
                          <td class="num">${nf0(s.qty)}</td>
                        </tr>
                      `).join("")}
                    </tbody>
                  </table>`;
                return `
                  <tr>
                    <td style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${esc(r.itemId)}</td>
                    <td>
                      ${esc(r.itemName)}
                      ${storesHtml}
                    </td>
                    <td>${esc(r.unit)}</td>
                    <td class="num row-total">${nf0(r.totalQty)}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        `;
      }).join("")}

      <div class="footer-note">※ 各品目の下に、店舗（納品先）ごとの数量内訳を表示しています。</div>
    </div>

    <script>window.onload = () => window.print();</script>
  </body></html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
}
