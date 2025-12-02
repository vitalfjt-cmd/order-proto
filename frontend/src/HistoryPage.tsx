
import React, { useEffect, useMemo, useState } from "react";
import { toCsvString, downloadCsv } from "./utils/csv";

// 既存 API と整合（server.ts の /ordering/list, /ordering/detail 前提）
type OrderListRow = {
  id: string;
  storeId: string;
  vendorId: string | null;
  orderDate: string;
  lineCount: number;
  total: number;
};
type OrderListResponse = {
  total: number;
  items: OrderListRow[];
  summary: { total: number; count: number };
};
type OrderDetail = {
  header: {
    id: string;
    storeId: string;
    vendorId: string | null;
    orderDate: string;
    expectedArrivalDate: string | null;
    subtotal: number;
    tax: number;
    total: number;
    createdAt?: string | null;
    updatedAt?: string | null;
  };
  lines: { itemId: string; itemName?: string; qty: number; unitPrice: number; amount: number }[];
};

function ymd(d: Date) {
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export default function HistoryPage() {
  const today = useMemo(() => ymd(new Date()), []);
  const [storeId, setStoreId] = useState("0002");    // 必要ならセレクト化
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);

  const [data, setData] = useState<OrderListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<OrderDetail | null>(null);

  async function load() {
    setLoading(true);
    try {
      // クエリを組み立て
      const q = new URLSearchParams({ storeId });
      // サーバ実装の違いに備えて両方のキーを入れておく（/ordering/list は start/end も from/to も受けられるようにしてある）
      q.set("start", start);
      q.set("from", start);
      q.set("end", end);
      q.set("to", end);

      const r = await fetch(`/ordering/list?${q.toString()}`);
      if (!r.ok) {
        // 失敗時は安全な空データを入れて画面を落とさない
        setData({ total: 0, items: [], summary: { total: 0, count: 0 } });
        return;
      }

      const j = await r.json();
      // 防御的に整形
      const safe: OrderListResponse = {
        total: Number(j?.total ?? 0),
        items: Array.isArray(j?.items) ? j.items : [],
        summary: {
          total: Number(j?.summary?.total ?? 0),
          count: Number(j?.summary?.count ?? j?.items?.length ?? 0),
        },
      };
      setData(safe);
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
      console.log("[detail] fetch /ordering/detail", orderId);
      const r = await fetch(`/ordering/detail?orderId=${encodeURIComponent(orderId)}`);
      if (!r.ok) {
        console.warn("[detail] http", r.status);
        alert("詳細の取得に失敗しました");
        return;
      }
      const dj = await r.json();
      setDetail({
        header: dj?.header ?? {
          id: orderId,
          storeId: "",
          vendorId: null,
          orderDate: "",
          expectedArrivalDate: null,
          subtotal: 0,
          tax: 0,
          total: 0,
          createdAt: null,
          updatedAt: null,
        },
        lines: Array.isArray(dj?.lines) ? dj.lines : []
      });
    } catch (e) {
      console.error(e);
      alert("ネットワークエラー");
    }
  }

  type ExportLine = {
    orderId: string;
    storeId: string; storeName: string;
    vendorId: string | null; vendorName: string | null;
    orderDate: string;
    itemId: string; itemName: string | null;
    qty: number; unitPrice: number; amount: number;
  };
  function csvEscape(s: string | number | null | undefined) {
    const t = String(s ?? "");
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  }
  function buildCsvLines(lines: ExportLine[]) {
    const header = [
      "orderId","storeId","storeName","vendorId","vendorName",
      "orderDate","itemId","itemName","qty","unitPrice","amount"
    ].join(",");
    const rows = lines.map(x => [
      x.orderId, x.storeId, x.storeName,
      x.vendorId ?? "", x.vendorName ?? "",
      x.orderDate, x.itemId, x.itemName ?? "",
      x.qty, x.unitPrice, x.amount
    ].map(v => csvEscape(String(v))).join(","));
    return [header, ...rows].join("\n");
  }  

  function download(name: string, text: string) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => { load(); /* 初回 */ }, []);

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">発注履歴（バックオフィス）</h1>
        <a className="underline" href="/">発注入力へ戻る</a>
      </div>

      <div className="mb-3 flex flex-wrap gap-2 items-center">
        <label className="text-sm">店舗</label>
        <input className="border rounded px-2 py-1 text-sm w-24" value={storeId} onChange={e=>setStoreId(e.target.value)} />
        <input type="date" className="border rounded px-2 py-1 text-sm" value={start} onChange={e=>setStart(e.target.value)} />
        <span className="text-sm">〜</span>
        <input type="date" className="border rounded px-2 py-1 text-sm" value={end} onChange={e=>setEnd(e.target.value)} />

        <button className="border rounded px-3 py-1 text-sm" onClick={load}>この期間で照会</button>
        <button
          className="border rounded px-3 py-1 text-sm"
          onClick={async ()=>{
            try {
              const q = new URLSearchParams({ storeId, start, from: start, end, to: end });
              const r = await fetch(`/ordering/export_lines?${q.toString()}`);
              if (!r.ok) { alert("CSVの取得に失敗しました"); return; }
              const j = await r.json();
              const lines: ExportLine[] = Array.isArray(j?.items) ? j.items : [];
              if (lines.length === 0) { alert("該当するデータがありません"); return; }
              // download(`orders_lines_${start}_to_${end}.csv`, buildCsvLines(lines));
              const csv = buildCsvLines(lines);
              downloadCsv(`orders_lines_${start}_to_${end}.csv`, csv);
            } catch(e) {
              console.error(e);
              alert("ネットワークエラー");
            }
          }}
        >CSVダウンロード</button>
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
                  <tr key={row.id || `${row.storeId}-${row.orderDate}-${row.vendorId ?? 'ALL'}`} className="border-b hover:bg-gray-50">
                    <td className="py-1 pr-3 font-mono">{row.id}</td>
                    <td className="py-1 pr-3">{row.storeId}</td>
                    <td className="py-1 pr-3">{row.vendorId ?? "(全)"} </td>
                    <td className="py-1 pr-3">{row.orderDate}</td>
                    <td className="py-1 pr-3 text-right">{row.lineCount}</td>
                    <td className="py-1 pr-3 text-right">¥{row.total.toLocaleString()}</td>
                    <td className="py-1 pr-0">
                      <button
                        className="border rounded px-2 py-0.5 text-xs"
                        onClick={() => {
                          console.log("[detail] open", row.id);   // ← 今回の確認ログ
                          openDetail(row.id);
                        }}
                      >
                        詳細
                      </button>
                    </td>
                  </tr>
                ))}

                {(!Array.isArray(data.items) || data.items.length === 0) && (
                  <tr key="empty"><td className="py-2 text-gray-500" colSpan={7}>該当なし</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* 詳細モーダル */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={()=>setDetail(null)}>
          <div className="bg-white rounded-lg shadow-xl p-4 w-[min(900px,96vw)]" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">
                注文詳細: <span className="font-mono">{detail.header.id}</span>
              </div>
              <button className="rounded border px-3 py-1 text-sm" onClick={()=>setDetail(null)}>閉じる</button>
            </div>
            <div className="text-sm mb-3 opacity-80">
              店舗: {detail.header.storeId}／ベンダ: {detail.header.vendorId ?? "(全)"}／
              発注日: {detail.header.orderDate}／納品予定: {detail.header.expectedArrivalDate ?? "-"}／
              合計: ¥{detail.header.total.toLocaleString()}
            </div>
            <div className="text-xs mb-2 text-gray-600">
              作成: {detail.header.createdAt ?? "-"}／
              更新: {detail.header.updatedAt ?? "-"}
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
