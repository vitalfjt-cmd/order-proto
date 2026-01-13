import React, { useEffect, useMemo, useState } from "react";
import type { OrderListResponse, OrderDetail } from "./ordering/types";
import { orderingApi } from "./ordering/orderingApi";
import { ymd } from "./utils/date"

type ExportLine = {
  orderId: string;
  storeId: string; storeName: string;
  vendorId: string | null; vendorName: string | null;
  orderDate: string;
  itemId: string; itemName: string | null;
  qty: number; unitPrice: number; amount: number;
};

function csvEscape(v: string | number | null | undefined) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(lines: ExportLine[]) {
  const header = [
    "orderId", "storeId", "storeName", "vendorId", "vendorName",
    "orderDate", "itemId", "itemName", "qty", "unitPrice", "amount"
  ].join(",");

  const rows = lines.map(x => ([
    x.orderId,
    x.storeId,
    x.storeName,
    x.vendorId ?? "",
    x.vendorName ?? "",
    x.orderDate,
    x.itemId,
    x.itemName ?? "",
    x.qty,
    x.unitPrice,
    x.amount
  ].map(csvEscape).join(",")));

  return [header, ...rows].join("\n");
}

function downloadText(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function HistoryPage() {
  const today = useMemo(() => ymd(new Date()), []);
  const [storeId, setStoreId] = useState("0002");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);

  const [data, setData] = useState<OrderListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<OrderDetail | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await orderingApi.list({ storeId, from: start, to: end });
      setData(res);
    } catch (e) {
      console.error(e);
      setData({ total: 0, items: [], summary: { total: 0, count: 0 } });
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(orderId: string) {
    if (!orderId) {
      alert("注文番号が不明です。");
      return;
    }
    try {
      const d = await orderingApi.detail(orderId);
      setDetail(d);
    } catch (e) {
      console.error(e);
      alert("詳細の取得に失敗しました");
    }
  }

  useEffect(() => { void load(); }, []); // 初回

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">発注履歴（バックオフィス）</h1>
        <a className="underline" href="/">発注入力へ戻る</a>
      </div>

      <div className="mb-3 flex flex-wrap gap-2 items-center">
        <label className="text-sm">店舗</label>
        <input
          className="border rounded px-2 py-1 text-sm w-24"
          value={storeId}
          onChange={e => setStoreId(e.target.value)}
        />

        <input type="date" className="border rounded px-2 py-1 text-sm" value={start} onChange={e => setStart(e.target.value)} />
        <span className="text-sm">〜</span>
        <input type="date" className="border rounded px-2 py-1 text-sm" value={end} onChange={e => setEnd(e.target.value)} />

        <button className="border rounded px-3 py-1 text-sm" onClick={load}>
          この期間で照会
        </button>

        <button
          className="border rounded px-3 py-1 text-sm"
          onClick={async () => {
            try {
              const j = await orderingApi.exportLinesJson({ storeId, from: start, to: end });
              const lines: ExportLine[] = Array.isArray(j?.items) ? (j.items as ExportLine[]) : []
              if (lines.length === 0) {
                alert("該当するデータがありません");
                return;
              }

              const csv = buildCsv(lines);
              downloadText(`orders_lines_${start}_to_${end}.csv`, csv);
            } catch (e) {
              console.error(e);
              alert("ネットワークエラー");
            }
          }}
        >
          CSVダウンロード
        </button>
      </div>

      {loading && <div>読み込み中…</div>}

      {data && (
        <>
          <div className="text-sm opacity-70 mb-2">
            件数: {data.total}／合計: ¥{data.summary.total.toLocaleString()}
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-1 pr-3">注文番号</th>
                  <th className="py-1 pr-3">店舗</th>
                  <th className="py-1 pr-3">ベンダ</th>
                  <th className="py-1 pr-3">発注日</th>
                  <th className="py-1 pr-3 text-right">明細</th>
                  <th className="py-1 pr-3 text-right">合計</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map(row => (
                  <tr
                    key={row.id || `${row.storeId}-${row.orderDate}-${row.vendorId ?? "ALL"}`}
                    className="border-b hover:bg-gray-50"
                  >
                    <td className="py-1 pr-3 font-mono">{row.id}</td>
                    <td className="py-1 pr-3">{row.storeId}</td>
                    <td className="py-1 pr-3">{row.vendorId ?? "(全)"}</td>
                    <td className="py-1 pr-3">{row.orderDate}</td>
                    <td className="py-1 pr-3 text-right">{row.lineCount}</td>
                    <td className="py-1 pr-3 text-right">¥{row.total.toLocaleString()}</td>
                    <td className="py-1 pr-0">
                      <button
                        className="border rounded px-2 py-0.5 text-xs"
                        onClick={() => openDetail(row.id)}
                      >
                        詳細
                      </button>
                    </td>
                  </tr>
                ))}

                {data.items.length === 0 && (
                  <tr><td className="py-2 text-gray-500" colSpan={7}>該当なし</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* 詳細モーダル */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-lg shadow-xl p-4 w-[min(900px,96vw)]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">
                注文詳細: <span className="font-mono">{detail.header.id}</span>
              </div>
              <button className="rounded border px-3 py-1 text-sm" onClick={() => setDetail(null)}>閉じる</button>
            </div>

            <div className="text-sm mb-3 opacity-80">
              店舗: {detail.header.storeId}／ベンダ: {detail.header.vendorId ?? "(全)"}／
              発注日: {detail.header.orderDate}／納品予定: {detail.header.expectedArrivalDate ?? "-"}／
              合計: ¥{detail.header.total.toLocaleString()}
            </div>

            <div className="text-xs mb-2 text-gray-600">
              作成: {detail.header.createdAt ?? "-"}／更新: {detail.header.updatedAt ?? "-"}
            </div>

            <div className="overflow-x-auto max-h-[60vh]">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b sticky top-0 bg-white">
                    <th className="py-1 pr-3">品目（コード／名称）</th>
                    <th className="py-1 pr-3 text-right">数量</th>
                    <th className="py-1 pr-3 text-right">単価</th>
                    <th className="py-1 pr-3 text-right">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((ln, i) => (
                    <tr key={`${detail.header.id}-${ln.itemId}-${i}`} className="border-b">
                      <td className="py-1 pr-3">
                        <div className="font-mono">{ln.itemId}</div>
                        <div className="text-xs text-slate-600">{ln.itemName ?? ""}</div>
                      </td>
                      <td className="py-1 pr-3 text-right">{ln.qty}</td>
                      <td className="py-1 pr-3 text-right">¥{ln.unitPrice.toLocaleString()}</td>
                      <td className="py-1 pr-3 text-right">¥{ln.amount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
