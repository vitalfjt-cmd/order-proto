// frontend/src/store/StoreStockList.tsx
import React, { useEffect, useState } from "react";
import { toCsvString, downloadCsv } from "../utils/csv";

type StoreStockRow = {
  storeId: string;
  itemId: string;
  itemName: string | null;
  spec: string | null;
  unit: string | null;
  qty: number;
};

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

export function StoreStockList() {
  const [storeIdInput, setStoreIdInput] = useState("0002");
  const [asOf, setAsOf] = useState<string>(todayYmd());
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<StoreStockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchStocks() {
    setLoading(true);
    setError(null);

    try {
      const storeId = storeIdInput.replace(/\D/g, "").padStart(4, "0");

      const params = new URLSearchParams({ storeId });
      if (keyword.trim()) {
        params.set("keyword", keyword.trim());
      }
      if (asOf) {
        params.set("asOf", asOf);
      }

      const resp = await fetch(`/stocks/store-stocks?${params.toString()}`);

      if (!resp.ok) {
        console.error("store-stocks failed", resp.status, await resp.text());
        setError("在庫の取得に失敗しました。");
        setRows([]);
        return;
      }

      const json = (await resp.json()) as {
        ok?: boolean;
        error?: string;
        storeId?: string;
        asOf?: string;
        rows?: StoreStockRow[];
      };

      if (json.ok === false) {
        setError(json.error || "在庫の取得に失敗しました。");
        setRows([]);
        return;
      }

      setRows(json.rows ?? []);
      // サーバー側で asOf を補正している場合もあるので同期
      if (json.asOf) {
        setAsOf(json.asOf);
      }
    } catch (e) {
      console.error(e);
      setError("通信エラーが発生しました。");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  // 初回ロード
  useEffect(() => {
    fetchStocks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalItems = rows.length;
  const totalQty = rows.reduce((sum, r) => sum + (r.qty ?? 0), 0);

  // CSV 出力
  function handleCsvDownload() {
    if (rows.length === 0) return;

    const header = ["店舗ID", "基準日", "品目ID", "品目名", "規格", "単位", "在庫数"];
    const body = rows.map((r) => [
      r.storeId,
      asOf,
      r.itemId,
      r.itemName ?? "",
      r.spec ?? "",
      r.unit ?? "",
      r.qty,
    ]);

    const csv = toCsvString([header, ...body], { delimiter: "," });
    const fileStore = storeIdInput.replace(/\D/g, "").padStart(4, "0");
    const fileDate = (asOf || todayYmd()).replaceAll("-", "");
    const filename = `store_stock_${fileStore}_${fileDate}.csv`;
    downloadCsv(filename, csv);
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg font-semibold">店舗在庫一覧</h1>

      {/* 検索フォーム */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-600">店舗ID</label>
          <input
            type="text"
            value={storeIdInput}
            onChange={(e) => setStoreIdInput(e.target.value)}
            className="border rounded px-2 py-1 text-sm w-24"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-600">基準日</label>
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-600">キーワード</label>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="品目ID・名称・規格"
            className="border rounded px-2 py-1 text-sm w-64"
          />
        </div>

        <button
          type="button"
          onClick={fetchStocks}
          className="border rounded px-3 py-1 text-sm"
          disabled={loading}
        >
          {loading ? "検索中..." : "検索"}
        </button>

        <button
          type="button"
          onClick={handleCsvDownload}
          className="border rounded px-3 py-1 text-sm"
          disabled={rows.length === 0}
        >
          CSVダウンロード
        </button>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="text-sm text-red-600 border border-red-300 bg-red-50 px-3 py-2 rounded">
          {error}
        </div>
      )}

      {/* 件数サマリ */}
      <div className="text-xs text-gray-600">
        店舗ID: <span className="font-mono">{storeIdInput}</span>{" "}
        / 基準日: <span className="font-mono">{asOf}</span>{" "}
        / 品目数: <span className="font-semibold">{totalItems}</span>{" "}
        / 合計数量: <span className="font-semibold">{totalQty}</span>
      </div>

      {/* 一覧 */}
      <div className="border rounded overflow-auto max-h-[480px]">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-100">
            <tr>
              <th className="border px-2 py-1 text-left">品目ID</th>
              <th className="border px-2 py-1 text-left">品目名</th>
              <th className="border px-2 py-1 text-left">規格</th>
              <th className="border px-2 py-1 text-left">単位</th>
              <th className="border px-2 py-1 text-right">在庫数</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={5}
                  className="border px-2 py-3 text-center text-gray-500"
                >
                  該当する在庫がありません。
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.itemId}>
                <td className="border px-2 py-1 font-mono">{r.itemId}</td>
                <td className="border px-2 py-1">{r.itemName ?? ""}</td>
                <td className="border px-2 py-1">{r.spec ?? ""}</td>
                <td className="border px-2 py-1">{r.unit ?? ""}</td>
                <td className="border px-2 py-1 text-right">
                  {r.qty.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
