// src/reports/print/pickingPrint.ts
import type { VendorOrderHeader, VendorOrderLine } from "../../vendor/apiVendor";

// 既存の「フラット型」ピッキングPDF（そのまま残してあります）
export function openPickingPrint(
  headers: VendorOrderHeader[],
  lines: VendorOrderLine[]
) {
  const hMap = new Map(headers.map(h => [h.id, h]));
  const sorted = [...lines]
    .filter(l => (l.shipQty ?? 0) > 0)
    .sort((a, b) => {
      const ha = hMap.get(a.headerId)!;
      const hb = hMap.get(b.headerId)!;
      return (
        ha.deliveryDate.localeCompare(hb.deliveryDate) ||
        ha.vendorId.localeCompare(hb.vendorId) ||
        ha.destinationId.localeCompare(hb.destinationId) ||
        (a.itemId ?? "").localeCompare(b.itemId ?? "")
      );
    });

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>ピッキングリスト</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 16px; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    .meta { color:#475569; font-size: 12px; margin-bottom: 12px; }
    table { width:100%; border-collapse: collapse; }
    th, td { border-bottom:1px solid #e2e8f0; padding:6px 8px; }
    th { position: sticky; top: 0; background: white; }
    .right { text-align:right; }
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
  <div class="meta">行数: ${sorted.length}</div>
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
            <td>${l.unit ?? ""}</td>
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

// 店舗内訳付きピッキングPDF（品目ごと＋単位＋品目計）
type PickingGroup = { header: VendorOrderHeader; lines: VendorOrderLine[] };

export function openPickingPrintWithStores(groups: PickingGroup[]) {
  // ヘッダと行をフラット化
  const headers = groups.map(g => g.header);
  const hMap = new Map(headers.map(h => [h.id, h]));

  const allLines: VendorOrderLine[] = [];
  for (const g of groups) {
    for (const l of g.lines) {
      if ((l.shipQty ?? 0) > 0) {
        allLines.push(l);
      }
    }
  }

  // 品目単位にグルーピング
  type ItemGroup = {
    itemId: string;
    itemName: string;
    spec: string;
    unit: string;
    rows: { header: VendorOrderHeader; line: VendorOrderLine }[];
  };

  const itemMap = new Map<string, ItemGroup>();

  for (const line of allLines) {
    const h = hMap.get(line.headerId)!;
    const key = line.itemId;
    if (!key) continue;

    let grp = itemMap.get(key);
    if (!grp) {
      grp = {
        itemId: line.itemId,
        itemName: line.itemName ?? "",
        spec: line.spec ?? "",
        unit: line.unit ?? "",
        rows: [],
      };
      itemMap.set(key, grp);
    }
    grp.rows.push({ header: h, line });
  }

  const itemGroups = Array.from(itemMap.values()).sort((a, b) =>
    a.itemId.localeCompare(b.itemId)
  );

  const totalLines = allLines.length;
  const totalItems = itemGroups.length;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>ピッキングリスト（店舗内訳）</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 16px; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    .meta { color:#475569; font-size: 12px; margin-bottom: 12px; }
    table { width:100%; border-collapse: collapse; }
    th, td { border-bottom:1px solid #e2e8f0; padding:4px 6px; }
    th { background:#f8fafc; }
    .right { text-align:right; }
    .item-head td { border-top:2px solid #94a3b8; }
    .item-total td {
      font-weight: 600;
      background:#f9fafb;
      border-top:1px solid #cbd5e1;
    }
    @media print {
      .noprint { display:none; }
      tr { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="noprint" style="margin-bottom:12px">
    <button onclick="window.print()">印刷</button>
  </div>
  <h1>ピッキングリスト（店舗内訳）</h1>
  <div class="meta">
    品目数: ${totalItems} ／ 明細行数: ${totalLines}
  </div>
  <table>
    <thead>
      <tr>
        <th>品目コード</th>
        <th>品目名</th>
        <th>規格</th>
        <th>単位</th>
        <th>納品先</th>
        <th class="right">出荷数量</th>
      </tr>
    </thead>
    <tbody>
      ${itemGroups.map(g => {
        const rows = g.rows
          .sort((a, b) =>
            a.header.destinationId.localeCompare(b.header.destinationId)
          );
        const totalQty = rows.reduce(
          (sum, r) => sum + Number(r.line.shipQty ?? 0),
          0
        );
        const storeCount = rows.length;

        const rowHtml = rows
          .map((r, idx) => {
            const h = r.header;
            const showItem = idx === 0;
            return `
            <tr class="${showItem ? "item-head" : ""}">
              <td>${showItem ? g.itemId : ""}</td>
              <td>${showItem ? g.itemName : ""}</td>
              <td>${showItem ? g.spec : ""}</td>
              <td>${showItem ? (g.unit ?? "") : ""}</td>
              <td>${h.destinationId} ${h.destinationName ?? ""}</td>
              <td class="right">${r.line.shipQty}</td>
            </tr>`;
          })
          .join("");

        const totalRow = `
          <tr class="item-total">
            <td colspan="4"></td>
            <td class="right">品目計（${storeCount}件）</td>
            <td class="right">${totalQty}${g.unit ? " " + g.unit : ""}</td>
          </tr>`;

        return rowHtml + totalRow;
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
