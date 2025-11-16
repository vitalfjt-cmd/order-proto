// src/vendor/invoicePrint.tsx
import React from "react";
import type { VendorOrderHeader, VendorOrderLine, TempZone } from "./apiVendor";

/** 会社情報（必要に応じて編集してください） */
const COMPANY = {
  name: "〇〇株式会社",
  address: "〒100-0000 東京都千代田区丸の内1-1-1",
  tel: "03-0000-0000",
  fax: "03-0000-0001",
  // 発行者名は空なら表示しません（呼び出し側から差し込みたい場合は openInvoicePrint の引数拡張でもOK）
  issuer: "",
};

/** 価格付きかもしれない行を安全に読むためのヘルパ（any禁止対応） */
type WithOptionalPrice = { unitPrice?: unknown };
function hasUnitPrice(l: VendorOrderLine): l is VendorOrderLine & { unitPrice: number } {
  const v = (l as unknown as WithOptionalPrice).unitPrice;
  return typeof v === "number";
}
function getUnitPrice(l: VendorOrderLine): number | undefined {
  const v = (l as unknown as WithOptionalPrice).unitPrice;
  return typeof v === "number" ? v : undefined;
}

/** 数値フォーマッタ */
function nf0(n: number) { return new Intl.NumberFormat("ja-JP").format(n); }
/** HTMLエスケープ */
function esc(s: string | undefined | null) {
  const t = s ?? "";
  return t.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]!));
}

type Group = { header: VendorOrderHeader; lines: VendorOrderLine[] };

/** 納品書：選択した伝票を 店舗ごと1ページ で印刷ビュー表示 */
export function openInvoicePrint(groups: Group[]) {
  const win = window.open("", "_blank");
  if (!win) { alert("ポップアップがブロックされました。"); return; }

  const style = `
  <style>
    @media print {
      @page { size: A4; margin: 12mm; }
      .page { page-break-after: always; }
      .page:last-child { page-break-after: auto; }
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP",
                   "Yu Gothic UI", Roboto, Arial, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif;
      color:#111;
    }
    .header {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 12px;
      align-items: start;
      margin-bottom: 8px;
    }
    .company {
      border:1px solid #e5e7eb; border-radius:6px; padding:8px 10px;
    }
    .company .name { font-size: 18px; font-weight: 700; margin-bottom: 2px; }
    .company .addr { font-size: 12px; color:#374151; }
    .company .tel { font-size: 12px; color:#374151; }

    .titleBox {
      text-align: right;
    }
    .title {
      font-size: 20px; font-weight: 700; margin: 0;
    }
    .meta {
      font-size: 12px; color:#374151;
      display:flex; flex-direction: column; gap: 2px;
      margin-top: 4px;
    }

    table { width:100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border:1px solid #e5e7eb; padding:4px 6px; }
    th { background:#f8fafc; text-align:left; font-size: 12px; }
    td { font-size: 12px; }
    td.num, th.num { text-align:right; font-variant-numeric: tabular-nums; }

    .w-code   { width: 90px; }
    .w-name   { width: auto; }
    .w-unit   { width: 60px; }
    .w-spec   { width: 110px; }
    .w-price  { width: 90px; }
    .w-qty    { width: 80px; }
    .w-amount { width: 110px; }
    .w-note   { width: 140px; }
    .w-zone   { width: 70px; }

    .sumrow td { font-weight:bold; background:#f9fafb; }
    .muted { color:#64748b; }

    .footer {
      display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
      margin-top: 8px;
    }
    .sign {
      border:1px solid #e5e7eb; border-radius:6px; padding:6px 8px;
      font-size: 12px; color:#374151;
      height: 54px; display:flex; align-items:center; justify-content:space-between;
    }
    .sign .label { font-weight: 600; }
    .sign .line { flex: 1; border-bottom:1px solid #e5e7eb; margin-left: 8px; }

    .footMeta {
      text-align:right; color:#64748b; font-size: 11px; margin-top: 2px;
    }
  </style>`;

  const now = new Date();
  const nowStr =
    `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,"0")}/${String(now.getDate()).padStart(2,"0")} ` +
    `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;

  const html = `
  <!doctype html>
  <html lang="ja"><head><meta charset="utf-8"><title>納品書</title>${style}</head>
  <body>
    ${groups.map((g, i) => renderPage(g, i+1, groups.length, nowStr)).join("")}
    <script>window.onload = () => window.print();</script>
  </body></html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();

  function renderPage(g: Group, pageNo: number, pageCount: number, nowStrLocal: string) {
    // 並び：温度帯（常温→チルド→冷凍）→ 品目コード
    const zoneOrder: TempZone[] = ["ambient","chilled","frozen"];
    const sorted = [...g.lines].sort((a,b) => {
      const za = zoneOrder.indexOf(a.tempZone ?? "ambient");
      const zb = zoneOrder.indexOf(b.tempZone ?? "ambient");
      if (za !== zb) return za - zb;
      return (a.itemId || "").localeCompare(b.itemId || "");
    });

    const withPrice = sorted.some(hasUnitPrice);
    const subtotal = withPrice
      ? sorted.reduce((s, x) => s + (getUnitPrice(x) ?? 0) * (Number(x.shipQty) || 0), 0)
      : 0;
    const taxRate = 0.10; // 必要に応じてヘッダ/設定由来に
    const tax = withPrice ? Math.floor(subtotal * taxRate) : 0;
    const total = withPrice ? subtotal + tax : 0;

    const zoneJp: Record<string,string> = { ambient:"常温", chilled:"チルド", frozen:"冷凍" };

    return `
    <div class="page">
      <!-- ヘッダ：会社情報 + タイトル/伝票情報 -->
      <div class="header">
        <div class="company">
          <div class="name">${esc(COMPANY.name)}</div>
          <div class="addr">${esc(COMPANY.address)}</div>
          <div class="tel">TEL: ${esc(COMPANY.tel)} FAX: ${esc(COMPANY.fax)}</div>
        </div>
        <div class="titleBox">
          <h1 class="title">納品書</h1>
          <div class="meta">
            <div>発行日時：${nowStrLocal}</div>
            <div>ページ：${pageNo} / ${pageCount}</div>
          </div>
        </div>
      </div>

      <!-- 納品先／伝票情報 -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 6px;">
        <div style="border:1px solid #e5e7eb; border-radius:6px; padding:6px 8px;">
          <div style="font-weight:600; margin-bottom:4px;">納品先</div>
          <div><strong>${esc(g.header.destinationId)} ${esc(g.header.destinationName)}</strong></div>
        </div>
        <div style="border:1px solid #e5e7eb; border-radius:6px; padding:6px 8px;">
          <div style="font-weight:600; margin-bottom:4px;">伝票情報</div>
          <div>納品日：<strong>${esc(g.header.deliveryDate)}</strong></div>
          <div>伝票番号：<strong>${esc(g.header.id)}</strong></div>
          <div>ベンダー：<strong>${esc(g.header.vendorId)}</strong></div>
        </div>
      </div>

      <!-- 明細 -->
      <table>
        <colgroup>
          <col class="w-code" />
          <col class="w-name" />
          <col class="w-unit" />
          <col class="w-spec" />
          ${withPrice ? `<col class="w-price" />` : ``}
          <col class="w-qty" />
          ${withPrice ? `<col class="w-amount" />` : ``}
          <col class="w-note" />
          <col class="w-zone" />
        </colgroup>
        <thead>
          <tr>
            <th>品目コード</th>
            <th>品目名</th>
            <th>単位</th>
            <th>規格</th>
            ${withPrice ? `<th class="num">単価</th>` : ``}
            <th class="num">数量</th>
            ${withPrice ? `<th class="num">金額</th>` : ``}
            <th>備考/ロット</th>
            <th>温度帯</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(x => {
            const qty = Number(x.shipQty) || 0;
            const price = getUnitPrice(x) ?? 0;
            const amt = withPrice ? price * qty : 0;
            return `
              <tr>
                <td style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${esc(x.itemId)}</td>
                <td>${esc(x.itemName)}</td>
                <td>${esc(x.unit)}</td>
                <td>${esc(x.spec)}</td>
                ${withPrice ? `<td class="num">${nf0(price)}</td>` : ``}
                <td class="num">${nf0(qty)}</td>
                ${withPrice ? `<td class="num">${nf0(amt)}</td>` : ``}
                <td class="muted">${esc(x.note || x.lotNo)}</td>
                <td>${esc(zoneJp[x.tempZone ?? "ambient"])}</td>
              </tr>
            `;
          }).join("")}
          ${withPrice ? `
            <tr class="sumrow"><td colspan="5" class="num">小計</td><td class="num">${nf0(subtotal)}</td><td colspan="2"></td></tr>
            <tr class="sumrow"><td colspan="5" class="num">消費税(10%)</td><td class="num">${nf0(tax)}</td><td colspan="2"></td></tr>
            <tr class="sumrow"><td colspan="5" class="num">合計</td><td class="num">${nf0(total)}</td><td colspan="2"></td></tr>
          ` : ``}
        </tbody>
      </table>

      <!-- フッタ：発行者/担当欄 -->
      <div class="footer">
        <div class="sign">
          <div class="label">発行者</div>
          <div class="line"></div>
          <div style="margin-left:8px;">${esc(COMPANY.issuer)}</div>
        </div>
        <div class="sign">
          <div class="label">受領者（署名）</div>
          <div class="line"></div>
        </div>
      </div>
      <div class="footMeta">
        ※ 本書は店舗ごとの納品書です。数量・温度帯をご確認ください。
      </div>
    </div>`;
  }
}
