// frontend/src/store/StoreMonthlySummary.tsx
import React, { useEffect, useState } from "react";
import { toCsvString, downloadCsv } from "../utils/csv";

type MonthlySummaryRowBase = {
  storeId: string;
  itemId: string;
  openingQty: number;
  receiptQty: number;
  issueQty: number;
  adjustmentQty: number;
  closingQty: number;
};

type MonthlySummaryRow = MonthlySummaryRowBase & {
  actualQty: number | null; // 実棚
};

function currentMonth(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function StoreMonthlySummary(props: { defaultStoreId?: string }) {
  const [storeIdInput, setStoreIdInput] = useState<string>(
    props.defaultStoreId ?? "0002"
  );
  const [month, setMonth] = useState<string>(currentMonth());
  const [rows, setRows] = useState<MonthlySummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchSummary() {
    setLoading(true);
    setError(null);
    try {
      const storeId = storeIdInput.replace(/\D/g, "").padStart(4, "0");

      const params = new URLSearchParams({
        storeId,
        month,
      });

      const resp = await fetch(`/stocks/monthly-summary?${params.toString()}`);
      if (!resp.ok) {
        console.error(
          "monthly-summary failed",
          resp.status,
          await resp.text()
        );
        setError("月次サマリの取得に失敗しました。");
        setRows([]);
        return;
      }

      const json = (await resp.json()) as {
        ok?: boolean;
        error?: string;
        storeId?: string;
        month?: string;
        rows?: MonthlySummaryRowBase[];
      };

      if (json.ok === false) {
        setError(json.error || "月次サマリの取得に失敗しました。");
        setRows([]);
        return;
      }

      const baseRows = json.rows ?? [];

      // 実棚列を追加（初期値 = 期末在庫）
      const extended: MonthlySummaryRow[] = baseRows.map((r) => ({
        ...r,
        actualQty: r.closingQty,
      }));

      setRows(extended);

      // サーバー側で補正された storeId / month を反映
      if (json.storeId) {
        setStoreIdInput(json.storeId);
      }
      if (json.month) {
        setMonth(json.month);
      }
    } catch (e) {
      console.error(e);
      setError("通信エラーが発生しました。");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  // 初期表示で一度取得
  useEffect(() => {
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 合計（列ごと）
  const totals = rows.reduce(
    (acc, r) => {
      acc.opening += r.openingQty ?? 0;
      acc.receipt += r.receiptQty ?? 0;
      acc.issue += r.issueQty ?? 0;
      acc.adjust += r.adjustmentQty ?? 0;
      acc.closing += r.closingQty ?? 0;
      acc.actual += r.actualQty ?? r.closingQty ?? 0;
      return acc;
    },
    { opening: 0, receipt: 0, issue: 0, adjust: 0, closing: 0, actual: 0 }
  );

  function handleCsvDownload() {
    if (rows.length === 0) return;

    const header = [
      "店舗ID",
      "対象月",
      "品目ID",
      "期首在庫",
      "入庫",
      "出庫",
      "調整",
      "期末在庫",
      "実棚",
      "差異(実棚-期末)",
    ];

    const body = rows.map((r) => {
      const actual = r.actualQty ?? r.closingQty;
      const diff = actual - r.closingQty;
      return [
        r.storeId,
        month,
        r.itemId,
        r.openingQty,
        r.receiptQty,
        r.issueQty,
        r.adjustmentQty,
        r.closingQty,
        actual,
        diff,
      ];
    });

    const csv = toCsvString([header, ...body], { delimiter: "," });
    const fileStore = storeIdInput.replace(/\D/g, "").padStart(4, "0");
    const fileMonth = month.replace("-", "");
    const filename = `store_monthly_${fileStore}_${fileMonth}.csv`;
    downloadCsv(filename, csv);
  }

  function handleActualChange(index: number, value: string) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r;
        if (value.trim() === "") {
          return { ...r, actualQty: null };
        }
        const n = Number(value);
        if (!Number.isFinite(n)) return r;
        return { ...r, actualQty: n };
      })
    );
  }

  async function handleApplyPhysicalCount() {
    if (rows.length === 0) return;

    const storeId = storeIdInput.replace(/\D/g, "").padStart(4, "0");

    // 差異のある品目だけを送る
    const lines = rows
      .map((r) => {
        const actual = r.actualQty ?? r.closingQty;
        return {
          itemId: r.itemId,
          closingQty: r.closingQty,
          actualQty: actual,
        };
      })
      .filter((ln) => ln.actualQty !== ln.closingQty);

    if (lines.length === 0) {
      alert("差異のある品目がありません。");
      return;
    }

    if (
      !window.confirm(
        `店舗 ${storeId} / ${month} の実棚を反映しますか？\n` +
          `差異のある品目 ${lines.length} 件に ADJUSTMENT を登録します。`
      )
    ) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const resp = await fetch("/stocks/monthly-adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId,
          month,
          lines,
        }),
      });

      if (!resp.ok) {
        console.error("monthly-adjust failed", resp.status, await resp.text());
        setError("実棚の反映に失敗しました。");
        return;
      }

      const json = (await resp.json()) as {
        ok?: boolean;
        error?: string;
        inserted?: number;
      };

      if (json.ok === false) {
        setError(json.error || "実棚の反映に失敗しました。");
        return;
      }

      const inserted = json.inserted ?? 0;
      alert(`実棚の反映が完了しました。（調整行 ${inserted} 件）`);

      // 反映後の在庫を再取得（closingQty が実棚に追いつく）
      await fetchSummary();
    } catch (e) {
      console.error(e);
      setError("通信エラーが発生しました。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg font-semibold">店舗在庫 月次サマリ / 実棚入力</h1>

      {/* 条件入力 */}
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
          <label className="block text-xs text-gray-600">
            対象月（YYYY-MM）
          </label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
        </div>

        <button
          type="button"
          onClick={fetchSummary}
          className="border rounded px-3 py-1 text-sm"
          disabled={loading || saving}
        >
          {loading ? "集計中..." : "集計"}
        </button>

        <button
          type="button"
          onClick={handleCsvDownload}
          className="border rounded px-3 py-1 text-sm"
          disabled={rows.length === 0}
        >
          CSVダウンロード
        </button>

        <button
          type="button"
          onClick={handleApplyPhysicalCount}
          className="border rounded px-3 py-1 text-sm bg-blue-600 text-white"
          disabled={rows.length === 0 || saving}
        >
          {saving ? "反映中..." : "実棚を反映"}
        </button>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="text-sm text-red-600 border border-red-300 bg-red-50 px-3 py-2 rounded">
          {error}
        </div>
      )}

      {/* サマリ */}
      <div className="text-xs text-gray-600">
        店舗ID: <span className="font-mono">{storeIdInput}</span> / 対象月:{" "}
        <span className="font-mono">{month}</span> / 品目数:{" "}
        <span className="font-semibold">{rows.length}</span>
      </div>

      {/* 一覧 */}
      <div className="border rounded overflow-auto max-h-[480px]">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-100">
            <tr>
              <th className="border px-2 py-1 text-left">品目ID</th>
              <th className="border px-2 py-1 text-right">期首在庫</th>
              <th className="border px-2 py-1 text-right">入庫</th>
              <th className="border px-2 py-1 text-right">出庫</th>
              <th className="border px-2 py-1 text-right">調整</th>
              <th className="border px-2 py-1 text-right">期末在庫</th>
              <th className="border px-2 py-1 text-right">実棚</th>
              <th className="border px-2 py-1 text-right">
                差異(実棚-期末)
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={8}
                  className="border px-2 py-3 text-center text-gray-500"
                >
                  該当するデータがありません。
                </td>
              </tr>
            )}
            {rows.map((r, idx) => {
              const actual = r.actualQty ?? r.closingQty;
              const diff = actual - r.closingQty;
              return (
                <tr key={r.itemId}>
                  <td className="border px-2 py-1 font-mono">{r.itemId}</td>
                  <td className="border px-2 py-1 text-right">
                    {r.openingQty.toLocaleString()}
                  </td>
                  <td className="border px-2 py-1 text-right">
                    {r.receiptQty.toLocaleString()}
                  </td>
                  <td className="border px-2 py-1 text-right">
                    {r.issueQty.toLocaleString()}
                  </td>
                  <td className="border px-2 py-1 text-right">
                    {r.adjustmentQty.toLocaleString()}
                  </td>
                  <td className="border px-2 py-1 text-right">
                    {r.closingQty.toLocaleString()}
                  </td>
                  <td className="border px-2 py-1 text-right">
                    <input
                      type="number"
                      step="0.01"
                      className="border rounded px-1 py-0.5 w-20 text-right"
                      value={
                        r.actualQty === null
                          ? ""
                          : String(r.actualQty ?? r.closingQty)
                      }
                      onChange={(e) =>
                        handleActualChange(idx, e.target.value)
                      }
                    />
                  </td>
                  <td
                    className={`border px-2 py-1 text-right ${
                      diff === 0
                        ? ""
                        : diff > 0
                        ? "text-blue-600"
                        : "text-rose-600"
                    }`}
                  >
                    {diff === 0 ? "-" : diff.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-gray-50">
              <tr>
                <th className="border px-2 py-1 text-right">合計</th>
                <th className="border px-2 py-1 text-right">
                  {totals.opening.toLocaleString()}
                </th>
                <th className="border px-2 py-1 text-right">
                  {totals.receipt.toLocaleString()}
                </th>
                <th className="border px-2 py-1 text-right">
                  {totals.issue.toLocaleString()}
                </th>
                <th className="border px-2 py-1 text-right">
                  {totals.adjust.toLocaleString()}
                </th>
                <th className="border px-2 py-1 text-right">
                  {totals.closing.toLocaleString()}
                </th>
                <th className="border px-2 py-1 text-right">
                  {totals.actual.toLocaleString()}
                </th>
                <th className="border px-2 py-1 text-right">-</th>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
