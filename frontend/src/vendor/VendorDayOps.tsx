// src/vendor/VendorDayOps.tsx
import React, { useEffect, useState } from "react";
import { searchShipments } from "./apiVendor";
import { buildPickingCsv } from "./pickingCsv";
import { downloadCsv } from "../utils/csv"; // 既存のDLヘルパを流用
import { openInvoicePrint } from "./invoicePrint";
import type { VendorOrderHeader, VendorOrderLine } from "./apiVendor";
import { openPickingPrintWithStores } from "./pickingPrint";

export default function VendorDayOps() {
  const today = new Date().toISOString().slice(0,10);
  const [date, setDate] = useState(today);
  const [vendorId, setVendorId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [headers, setHeaders] = useState<VendorOrderHeader[]>([]);
  const [lines, setLines] = useState<VendorOrderLine[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});


  useEffect(() => { doSearch(); }, []);

  async function doSearch() {
    const res = await searchShipments({ dateFrom: date, dateTo: date, vendorId, destinationId });
    setHeaders(res.headers);
    setLines(res.lines);
    const initSel: Record<string, boolean> = {};
    for (const h of res.headers) initSel[h.id] = false;
    setSelected(initSel);
  }

  function handlePickingCsv() {
    const csv = buildPickingCsv(headers, lines, { includeHeader: true, delimiter: "," });
    downloadCsv(`picking_${vendorId || "all"}_${date}.csv`, csv);
  }

  function handleInvoicePdf() {
    const ids = Object.entries(selected).filter(([,v]) => v).map(([k]) => k);
    if (ids.length === 0) { alert("対象の伝票を選択してください。"); return; }
    const groups = headers
      .filter(h => ids.includes(h.id))
      .map(h => ({ header: h, lines: lines.filter(l => l.headerId === h.id) }));
    openInvoicePrint(groups);
  }

  return (
    <div className="p-3">
      <h1 className="text-xl font-bold mb-2">当日オペ（単日）</h1>
      <div className="flex flex-wrap items-end gap-3 mb-2">
        <label>納品日
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} className="border rounded px-2 py-1"/>
        </label>
        <label>ベンダー
          <input value={vendorId} onChange={e=>setVendorId(e.target.value)} className="border rounded px-2 py-1 w-28"/>
        </label>
        <label>納品先ID
          <input value={destinationId} onChange={e=>setDestinationId(e.target.value)} className="border rounded px-2 py-1 w-28"/>
        </label>
        <button className="border rounded px-3 py-1" onClick={doSearch}>検索</button>

        <div className="ml-auto flex gap-2">
          <button
            className="border rounded px-3 py-1"
            onClick={() => {
              const ids = Object.entries(selected).filter(([,v]) => v).map(([k]) => k);
              if (ids.length === 0) { alert("対象の伝票を選択してください。"); return; }
              const groups = headers
                .filter(h => ids.includes(h.id))
                .map(h => ({ header: h, lines: lines.filter(l => l.headerId === h.id) }));
              openPickingPrintWithStores(groups);
            }}
          >
            ピッキングPDF（店舗内訳）
          </button>
          <button className="border rounded px-3 py-1" onClick={handlePickingCsv}>ピッキングCSV</button>
          <button className="border rounded px-3 py-1" onClick={handleInvoicePdf}>納品書PDF（店舗ごと）</button>
        </div>
      </div>

      <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col style={{ width: 40 }} />       {/* チェック列 */}
            <col style={{ width: 160 }} />      {/* 伝票番号 */}
            <col style={{ width: 120 }} />      {/* 納品日 */}
            <col style={{ width: 120 }} />      {/* ベンダー */}
            <col />                             {/* 納品先（可変） */}
            <col style={{ width: 90 }} />       {/* 状態 */}
          </colgroup>
        <thead>
          <tr className="[&>th]:border-b [&>th]:py-1 [&>th]:px-2">
            {/* 1列目＝全選択 */}
            <th className="w-10 text-center">
              <input
                type="checkbox"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const checked = e.target.checked;
                  const next: Record<string, boolean> = {};
                  // confirmed は選択不可にする場合は open のみ
                  for (const h of headers) {
                    if (h.status === "open") next[h.id] = checked;
                  }
                  setSelected(next);
                }}
                checked={
                  headers.length > 0 &&
                  headers.filter(h => h.status === "open").every(h => selected[h.id])
                }
                aria-label="すべて選択"
              />
            </th>

            {/* 以降は通常列 */}
            <th>伝票番号</th>
            <th>納品日</th>
            <th>ベンダー</th>
            <th>納品先</th>
            <th>状態</th>
          </tr>
        </thead>
        <tbody>
          {headers.map(h => {
            const checked = !!selected[h.id];
            const isConfirmed = h.status === "confirmed";
            return (
              <tr key={h.id} className="[&>td]:border-b [&>td]:py-1 [&>td]:px-2">
                {/* 1列目＝行選択 */}
                <td className="w-10 text-center">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => setSelected(prev => ({ ...prev, [h.id]: e.target.checked }))}
                    disabled={isConfirmed} // 確定は選択不可にする場合
                    aria-label={`${h.id} を選択`}
                  />
                </td>

                <td className="font-mono text-sm">{h.id}</td>
                <td>{h.deliveryDate}</td>
                {/* <td>{h.vendorId}</td> */}
                <td>{h.vendorName || h.vendorId}</td>
                {/* <td>{h.destinationId} {h.destinationName ?? ""}</td> */}
                <td>{h.destinationName || h.destinationId}</td>
                <td>{h.status}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
