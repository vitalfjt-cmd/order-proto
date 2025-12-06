// frontend/src/store/StoreShipmentList.tsx
import React, { useEffect, useState } from "react";
import {
  searchStoreShipments,
  confirmStoreShipments,
  type StoreShipmentHeader,
  type StoreShipmentMovementType,
  type StoreShipmentStatus,
} from "./storeShipmentsApi";

type Props = {
  storeId: string;               // 例: "0002"
  onCreate?: () => void;         // 新規作成（Step4 で利用予定）
  onEdit?: (headerId: number) => void; // 編集画面へ（Step4 で利用予定）
};

const movementTypeLabel: Record<StoreShipmentMovementType, string> = {
  TRANSFER: "店舗移動",
  DISPOSAL: "廃棄",
};

const statusLabel: Record<StoreShipmentStatus, string> = {
  draft: "下書き",
  confirmed: "確定",
};

export default function StoreShipmentList({ storeId, onCreate, onEdit }: Props) {
  const today = new Date().toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [movementType, setMovementType] =
    useState<StoreShipmentMovementType | "">("");
  const [status, setStatus] = useState<StoreShipmentStatus | "">("");

  const [rows, setRows] = useState<StoreShipmentHeader[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void doSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doSearch() {
    setLoading(true);
    try {
      const headers = await searchStoreShipments({
        storeId,
        from: dateFrom,
        to: dateTo,
        movementType: movementType || undefined,
        status: status || undefined,
      });
      setRows(headers);

      const sel: Record<number, boolean> = {};
      for (const h of headers) sel[h.id] = false;
      setSelected(sel);
    } catch (e) {
      console.error(e);
      alert("店舗出荷一覧の取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  function toggleAll(checked: boolean) {
    setSelected(() => {
      const next: Record<number, boolean> = {};
      for (const h of rows) next[h.id] = checked;
      return next;
    });
  }

  async function handleConfirmSelected() {
    const ids = rows.filter(h => selected[h.id]).map(h => h.id);
    if (ids.length === 0) {
      alert("確定する伝票を選択してください。");
      return;
    }
    if (!window.confirm(`${ids.length}件の伝票を確定します。よろしいですか？`)) return;

    try {
      const res = await confirmStoreShipments(ids);
      alert(`確定しました（updated=${res.updated}）`);
      void doSearch();
    } catch (e) {
      console.error(e);
      alert("確定に失敗しました。");
    }
  }

  async function handleResetConditions() {
    setDateFrom(today);
    setDateTo(today);
    setMovementType("");
    setStatus("");

    try {
      const headers = await searchStoreShipments({
        storeId,
        from: today,
        to: today,
      });
      setRows(headers);

      const sel: Record<number, boolean> = {};
      for (const h of headers) sel[h.id] = false;
      setSelected(sel);
    } catch (e) {
      console.error(e);
      alert("店舗出荷一覧の取得に失敗しました。");
    }
  }

  return (
    <div className="p-3">
      <h1 className="text-xl font-bold mb-3">店舗出荷（店舗移動・廃棄）</h1>

      {/* 検索条件 */}
      <div className="flex flex-wrap items-end gap-3 mb-3 text-sm">
        <label>
          出荷日(自)
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="border rounded px-2 py-1 ml-1"
          />
        </label>
        <label>
          出荷日(至)
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="border rounded px-2 py-1 ml-1"
          />
        </label>
        <label>
          区分
          <select
            value={movementType}
            onChange={e =>
              setMovementType(e.target.value as StoreShipmentMovementType | "")
            }
            className="border rounded px-2 py-1 ml-1"
          >
            <option value="">(すべて)</option>
            <option value="TRANSFER">店舗移動</option>
            <option value="DISPOSAL">廃棄</option>
          </select>
        </label>
        <label>
          状態
          <select
            value={status}
            onChange={e =>
              setStatus(e.target.value as StoreShipmentStatus | "")
            }
            className="border rounded px-2 py-1 ml-1"
          >
            <option value="">(すべて)</option>
            <option value="draft">下書き</option>
            <option value="confirmed">確定</option>
          </select>
        </label>

        <button
          type="button"
          className="border rounded px-3 py-1 ml-auto"
          onClick={() => void doSearch()}
          disabled={loading}
        >
          {loading ? "検索中..." : "検索"}
        </button>
        <button
          type="button"
          className="border rounded px-3 py-1"
          onClick={() => void handleResetConditions()}
        >
          条件リセット
        </button>
        {onCreate && (
          <button
            type="button"
            className="border rounded px-3 py-1 bg-blue-600 text-white"
            onClick={onCreate}
          >
            新規作成
          </button>
        )}
      </div>

      <div className="mb-2 text-sm text-slate-600">
        店舗ID: <span className="font-mono">{storeId}</span>
      </div>

      {/* 一覧テーブル */}
      <table className="w-full border-collapse table-fixed text-sm">
        <colgroup>
          <col style={{ width: 40 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 110 }} />
          <col style={{ width: 110 }} />
          <col style={{ width: 100 }} />
          <col style={{ width: 100 }} />
          <col />
          <col style={{ width: 90 }} />
        </colgroup>
        <thead>
          <tr className="[&>th]:border-b [&>th]:py-1 [&>th]:px-2 bg-slate-50">
            <th>
              <input
                type="checkbox"
                checked={
                  rows.length > 0 && rows.every(h => selected[h.id])
                }
                onChange={e => toggleAll(e.target.checked)}
              />
            </th>
            <th>ID</th>
            <th>出荷日</th>
            <th>区分</th>
            <th>出荷元</th>
            <th>出荷先</th>
            <th>メモ</th>
            <th>状態</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(h => (
            <tr
              key={h.id}
              className="[&>td]:border-b [&>td]:py-1 [&>td]:px-2 hover:bg-slate-50"
            >
              <td>
                <input
                  type="checkbox"
                  checked={!!selected[h.id]}
                  onChange={e =>
                    setSelected(prev => ({
                      ...prev,
                      [h.id]: e.target.checked,
                    }))
                  }
                />
              </td>
              <td className="font-mono">{h.id}</td>
              <td>{h.shipmentDate}</td>
              <td>{movementTypeLabel[h.movementType]}</td>
              <td className="font-mono">{h.fromStoreId}</td>
              <td className="font-mono">{h.toStoreId ?? "-"}</td>
              <td className="truncate" title={h.memo ?? ""}>
                {h.memo ?? ""}
              </td>
              <td>
                <span
                  className={
                    h.status === "confirmed"
                      ? "text-green-700"
                      : "text-slate-700"
                  }
                >
                  {statusLabel[h.status]}
                </span>
                {onEdit && (
                  <button
                    type="button"
                    className="ml-2 border rounded px-2 py-0.5 text-xs"
                    onClick={() => onEdit(h.id)}
                  >
                    編集
                  </button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={8}
                className="text-center text-slate-500 py-6"
              >
                該当なし
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="mt-3 flex justify-between items-center text-sm">
        <div>件数: {rows.length} 件</div>
        <button
          type="button"
          className="border rounded px-3 py-1"
          onClick={() => void handleConfirmSelected()}
        >
          選択を確定
        </button>
      </div>
    </div>
  );
}
