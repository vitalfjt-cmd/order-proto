import React, { useEffect, useMemo, useState } from "react";
import { toCsvString, downloadCsv } from "../utils/csv";
import {
  getValuationSettings,
  setValuationSettings,
  type ValuationMethod,
} from "./storeStocksApi";

type MonthlySummaryRowBase = {
  storeId: string;
  itemId: string;

  itemName: string | null;
  unit: string | null;

  // 在庫単位あたり評価単価（backend: unitCost）
  unitCost?: number | null;

  openingQty: number;
  receiptQty: number;
  issueQty: number;
  adjustmentQty: number;
  closingQty: number;
};

type MonthlySummaryRow = MonthlySummaryRowBase & {
  actualQty: number | null; // 実棚（未入力は null）
};

function currentMonth(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function padStoreId(raw: string) {
  return String(raw ?? "").replace(/\D/g, "").padStart(4, "0");
}

function fmtNum(n: number, frac = 3) {
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString(undefined, { maximumFractionDigits: frac });
}

function fmtYen(n: number) {
  if (!Number.isFinite(n)) return "";
  return Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function StoreMonthlySummary(props: { defaultStoreId?: string }) {
  const [storeIdInput, setStoreIdInput] = useState<string>(props.defaultStoreId ?? "0002");
  const [month, setMonth] = useState<string>(currentMonth());
  const [rows, setRows] = useState<MonthlySummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>("");

  const [valuationMethod, setValuationMethod] = useState<ValuationMethod>("TOTAL_AVG");
  const [valuationLoading, setValuationLoading] = useState(false);

  // 評価単価方式を読み込み（storeIdInput が変わったら再取得）
  useEffect(() => {
    const storeId = padStoreId(storeIdInput);
    if (!/^\d{4}$/.test(storeId)) return;

    (async () => {
      setValuationLoading(true);
      try {
        const s = await getValuationSettings(storeId);
        setValuationMethod(s.method);
      } catch {
        // 未設定/通信失敗でも TOTAL_AVG のまま続行
      } finally {
        setValuationLoading(false);
      }
    })();
  }, [storeIdInput]);

  async function fetchSummary() {
    setError("");
    const storeId = padStoreId(storeIdInput);

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      setError("対象月（YYYY-MM）を指定してください。");
      return;
    }

    setLoading(true);
    try {
      const url = `/stocks/monthly-summary?storeId=${encodeURIComponent(storeId)}&month=${encodeURIComponent(
        month
      )}`;
      const r = await fetch(url);
      const json = (await r.json()) as {
        ok?: boolean;
        error?: string;
        storeId?: string;
        month?: string;
        valuationMethod?: ValuationMethod;
        rows?: MonthlySummaryRowBase[];
      };
      // 確認用 ここから
       console.log("[monthly-summary raw]", {
        ok: json.ok,
        storeId: json.storeId,
        month: json.month,
        valuationMethod: json.valuationMethod,
        firstRow: json.rows?.[0],
        row001001: json.rows?.find((x) => x.itemId === "001001"),
        row001018: json.rows?.find((x) => x.itemId === "001018"),
      });
      // ここまで
      if (!r.ok || json.ok === false) {
        setError(json.error || "月次サマリの取得に失敗しました。");
        setRows([]);
        return;
      }

      const baseRows = json.rows ?? [];
      const extended: MonthlySummaryRow[] = baseRows.map((x) => ({
        ...x,
        actualQty: x.closingQty, // 初期値：理論と同じ（原価=0スタート）
      }));
      // 確認用 ここから
        console.log("[monthly-summary extended]", {
        firstRow: extended[0],
        row001001: extended.find((x) => x.itemId === "001001"),
        row001018: extended.find((x) => x.itemId === "001018"),
      });
      // ここまで

      setRows(extended);
      if (json.storeId) setStoreIdInput(json.storeId);
      if (json.month) setMonth(json.month);
      if (json.valuationMethod) setValuationMethod(json.valuationMethod);
    } catch (e) {
      console.error(e);
      setError("通信エラーが発生しました。");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  function handleActualChange(index: number, value: string) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r;
        if (value.trim() === "") return { ...r, actualQty: null };
        const n = Number(value);
        if (!Number.isFinite(n)) return r;
        return { ...r, actualQty: n };
      })
    );
  }

  // 理論値（期首 + 入庫 - 出庫 + 調整）
  function theoreticalQty(r: MonthlySummaryRow) {
    const opening = Number(r.openingQty ?? 0);
    const receipt = Number(r.receiptQty ?? 0);
    const issue = Number(r.issueQty ?? 0);
    const adj = Number(r.adjustmentQty ?? 0);
    return opening + receipt - issue + adj;
  }

  function actualQtyOrTheoretical(r: MonthlySummaryRow) {
    const a = r.actualQty;
    return a == null ? theoreticalQty(r) : Number(a);
  }

  // ★理論 - 実棚
  function varianceQty(r: MonthlySummaryRow) {
    return theoreticalQty(r) - actualQtyOrTheoretical(r);
  }

  // ★原価：(理論 - 実棚) × 評価単価
  // - unitCost NULL は「未設定」扱い（画面表示は空）
  // - 合計は 0円として加算（あなたの方針）
  function costAmount(r: MonthlySummaryRow): number {
    const v = varianceQty(r);
    const ucRaw = r.unitCost;
    const uc = Number.isFinite(Number(ucRaw)) ? Number(ucRaw) : 0;
    if (!Number.isFinite(v)) return 0;
    return v * uc;
  }

  const totals = useMemo(() => {
    let varianceQtySum = 0;
    let costSum = 0;
    let costMissing = 0;

    for (const r of rows) {
      varianceQtySum += varianceQty(r);

      const uc0 = Number(r.unitCost ?? NaN);
      if (!Number.isFinite(uc0)) costMissing++; // 未設定件数
      costSum += costAmount(r);                 // 未設定は0円として加算
    }

    return { varianceQtySum, costSum, costMissing, totalRows: rows.length };
  }, [rows]);

  function handleCsvDownload() {
    if (rows.length === 0) return;

    const storeId = padStoreId(storeIdInput);

    const header = [
      "店舗ID",
      "対象月",
      "評価方式",
      "品目ID",
      "名称",
      "単位",
      "期首在庫",
      "入庫",
      "出庫",
      "調整",
      "理論値(期首+入庫-出庫+調整)",
      "実棚",
      "差異(理論-実棚)",
      "評価単価(在庫単位)",
      "原価(差異×評価単価)",
    ];

    const body: (string | number)[][] = rows.map((r) => {
      const theo = theoreticalQty(r);
      const act = actualQtyOrTheoretical(r);
      const vq = theo - act;

      const hasCost = Number.isFinite(Number(r.unitCost ?? NaN));
      const ca = costAmount(r);

      return [
        storeId,
        month,
        valuationMethod,
        r.itemId,
        r.itemName ?? "",
        r.unit ?? "",
        r.openingQty,
        r.receiptQty,
        r.issueQty,
        r.adjustmentQty,
        theo,
        act,
        vq,
        hasCost ? (r.unitCost ?? 0) : "",     // 未設定は空
        hasCost ? ca : "",                    // 未設定は空（合計は0円扱い）
      ];
    });

    body.push([
      storeId,
      month,
      valuationMethod,
      "TOTAL",
      "合計",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      totals.varianceQtySum,
      "",
      totals.costSum,
    ]);

    const csv = toCsvString([header, ...body], { delimiter: "," });
    const fileMonth = month.replace("-", "");
    downloadCsv(`store_monthly_${storeId}_${fileMonth}.csv`, csv);
  }

  async function handleApplyPhysicalCount() {
    if (rows.length === 0) return;

    const storeId = padStoreId(storeIdInput);

    const lines = rows
      .map((r) => {
        const theo = theoreticalQty(r);
        const act = actualQtyOrTheoretical(r);
        return { itemId: r.itemId, closingQty: theo, actualQty: act }; // closingQty=理論
      })
      .filter((ln) => ln.actualQty !== ln.closingQty);

    setSaving(true);
    setError("");
    try {
      const r = await fetch("/stocks/monthly-adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, month, lines }),
      });

      const json = (await r.json()) as { ok?: boolean; error?: string; inserted?: number };
      if (!r.ok || json.ok === false) {
        setError(json.error || "実棚反映に失敗しました。");
        return;
      }

      await fetchSummary();
      
      alert(`実棚を反映しました（調整行: ${json.inserted ?? lines.length}）`);
    } catch (e) {
      console.error(e);
      setError("通信エラーが発生しました。");
    } finally {
      setSaving(false);
    }
  }

  console.log("[render rows]", {
  len: rows.length,
  row001001: rows.find((x) => x.itemId === "001001"),
  row001018: rows.find((x) => x.itemId === "001018"),
});


  return (
    <div className="space-y-3">
      <div className="text-lg font-semibold">棚卸（月次）</div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-600">店舗ID</label>
          <input
            value={storeIdInput}
            onChange={(e) => setStoreIdInput(e.target.value)}
            className="border rounded px-2 py-1 text-sm w-24"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-600">対象月</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-600">評価方式</label>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={valuationMethod}
            disabled={valuationLoading}
            onChange={async (e) => {
              const storeId = padStoreId(storeIdInput);
              const m = e.target.value as ValuationMethod;
              setValuationMethod(m);
              try {
                await setValuationSettings(storeId, m);
              } catch {
                // 保存失敗でも画面は止めない（必要なら alert に変更）
              }
              // 方式切替後に再集計（将来MOVING_AVG実装時に反映される）
              await fetchSummary();
            }}
          >
            <option value="TOTAL_AVG">総平均</option>
            <option value="MOVING_AVG">移動平均</option>
          </select>
        </div>

        <button
          type="button"
          onClick={fetchSummary}
          className="border rounded px-3 py-1 text-sm bg-slate-800 text-white"
          disabled={loading}
        >
          {loading ? "取得中..." : "集計"}
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

      {error && (
        <div className="text-sm text-red-600 border border-red-300 bg-red-50 px-3 py-2 rounded">
          {error}
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap gap-4 text-sm border rounded px-3 py-2 bg-slate-50">
          <div>
            <span className="text-gray-600">差異数量合計（理論−実棚）：</span>
            <span className="font-semibold">{fmtNum(totals.varianceQtySum)}</span>
          </div>
          <div>
            <span className="text-gray-600">原価合計：</span>
            <span className="font-semibold">{fmtYen(totals.costSum)}</span>
          </div>
          {totals.costMissing > 0 && (
            <div className="text-gray-500">
              ※ 評価単価未設定：{totals.costMissing}/{totals.totalRows} 行（0円扱いで合計しています）
            </div>
          )}
        </div>
      )}

      <div className="border rounded overflow-auto max-h-[520px]">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-100">
            <tr>
              <th className="border px-2 py-1 text-left">品目ID</th>
              <th className="border px-2 py-1 text-left">名称</th>
              <th className="border px-2 py-1 text-left">単位</th>

              <th className="border px-2 py-1 text-right">期首</th>
              <th className="border px-2 py-1 text-right">入庫</th>
              <th className="border px-2 py-1 text-right">出庫</th>
              <th className="border px-2 py-1 text-right">調整</th>

              <th className="border px-2 py-1 text-right">理論値</th>
              <th className="border px-2 py-1 text-right">実棚</th>
              <th className="border px-2 py-1 text-right">差異(理論-実棚)</th>
              <th className="border px-2 py-1 text-right">評価単価</th>
              <th className="border px-2 py-1 text-right">原価</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={12} className="border px-2 py-3 text-center text-gray-500">
                  該当するデータがありません。
                </td>
              </tr>
            )}

            {rows.map((r, idx) => {
              const theo = theoreticalQty(r);
              const act = actualQtyOrTheoretical(r);
              const vq = theo - act;

              const hasCost = Number.isFinite(Number(r.unitCost ?? NaN));
              const ca = costAmount(r);

              return (
                <tr key={r.itemId}>
                  <td className="border px-2 py-1 font-mono">{r.itemId}</td>
                  <td className="border px-2 py-1">{r.itemName ?? ""}</td>
                  <td className="border px-2 py-1">{r.unit ?? ""}</td>
                  <td className="border px-2 py-1 text-right">{fmtNum(Number(r.openingQty ?? 0))}</td>
                  <td className="border px-2 py-1 text-right">{fmtNum(Number(r.receiptQty ?? 0))}</td>
                  <td className="border px-2 py-1 text-right">{fmtNum(Number(r.issueQty ?? 0))}</td>
                  <td className="border px-2 py-1 text-right">{fmtNum(Number(r.adjustmentQty ?? 0))}</td>

                  <td className="border px-2 py-1 text-right">{fmtNum(theo)}</td>

                  <td className="border px-2 py-1 text-right">
                    <input
                      type="number"
                      step="0.01"
                      className="border rounded px-1 py-0.5 w-24 text-right"
                      value={r.actualQty === null ? "" : String(r.actualQty)}
                      onChange={(e) => handleActualChange(idx, e.target.value)}
                    />
                  </td>

                  <td
                    className={`border px-2 py-1 text-right ${
                      vq === 0 ? "" : vq > 0 ? "text-rose-600" : "text-blue-600"
                    }`}
                    title="理論-実棚（+は棚卸不足、-は棚卸過多）"
                  >
                    {vq === 0 ? "-" : fmtNum(vq)}
                  </td>

                  <td className="border px-2 py-1 text-right">
                    {hasCost ? fmtYen(Number(r.unitCost)) : ""}
                  </td>

                  <td className="border px-2 py-1 text-right">
                    {hasCost ? fmtYen(ca) : ""}
                  </td>
                </tr>
              );
            })}

            {rows.length > 0 && (
              <tr className="bg-gray-50 font-semibold">
                <td className="border px-2 py-1 font-mono">TOTAL</td>
                <td className="border px-2 py-1">合計</td>
                <td className="border px-2 py-1"></td>

                <td className="border px-2 py-1 text-right"></td> {/* 期首 */}
                <td className="border px-2 py-1 text-right"></td> {/* 入庫 */}
                <td className="border px-2 py-1 text-right"></td> {/* 出庫 */}
                <td className="border px-2 py-1 text-right"></td> {/* 調整 */}

                <td className="border px-2 py-1 text-right"></td> {/* 理論 */}
                <td className="border px-2 py-1 text-right"></td> {/* 実棚 */}
                <td className="border px-2 py-1 text-right">{fmtNum(totals.varianceQtySum)}</td>
                <td className="border px-2 py-1 text-right"></td>
                <td className="border px-2 py-1 text-right">{fmtYen(totals.costSum)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-500">
        ※ 原価＝（理論値＝期首+入庫-出庫+調整 − 実棚）×評価単価（在庫単位）
      </div>
    </div>
  );
}
