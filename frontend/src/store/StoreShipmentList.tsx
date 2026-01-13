// frontend/src/store/StoreShipmentList.tsx
import React, { useEffect, useState } from "react";
import { ymd } from "../utils/date"
import {
  searchStoreShipments,
  confirmStoreShipments,
  type StoreShipmentHeader,
  type StoreShipmentMovementType,
  type StoreShipmentStatus,
  listMasterStores,
  type MasterStore,
} from "./storeShipmentsApi";

type Props = {
  storeId: string;               // 例: "0002"
  onChangeStoreId?: (storeId: string) => void;
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

export default function StoreShipmentList({ storeId, onChangeStoreId, onCreate, onEdit }: Props) {
  const today = ymd(new Date());
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [movementType, setMovementType] =
    useState<StoreShipmentMovementType | "">("");
  const [status, setStatus] = useState<StoreShipmentStatus | "">("");
  const [slipNo, setSlipNo] = useState<string>(""); // ★伝票番号

  const [rows, setRows] = useState<StoreShipmentHeader[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [storeIdInput, setStoreIdInput] = useState(storeId);
  useEffect(() => setStoreIdInput(storeId), [storeId]);

  const [storeModalOpen, setStoreModalOpen] = useState(false);
  const [storeKeyword, setStoreKeyword] = useState("");
  const [stores, setStores] = useState<MasterStore[]>([]);
  const [storesLoading, setStoresLoading] = useState(false);
  const clearResults = () => {
    setRows([]);
    // もし total/summary など別stateがあればここで一緒にクリア
  };


  useEffect(() => {
    if (!storeModalOpen) return;
    (async () => {
      setStoresLoading(true);
      try {
        const s = await listMasterStores();
        setStores(s);
      } catch (e) {
        console.error(e);
        alert("店舗一覧の取得に失敗しました。");
        setStores([]);
      } finally {
        setStoresLoading(false);
      }
    })();
  }, [storeModalOpen]);

  const storeName =
    stores.find((s) => s.id === storeIdInput)?.name ?? null;

  const filteredStores = stores.filter((s) => {
    const k = storeKeyword.trim();
    if (!k) return true;
    return s.id.includes(k) || (s.name ?? "").includes(k);
  });

  useEffect(() => {
    void doSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doSearch() {
    setLoading(true);
    try {
      const headers = await searchStoreShipments({
        storeId: storeIdInput,
        from: dateFrom,
        to: dateTo,
        movementType: movementType || undefined,
        status: status || undefined,
        slipNo: slipNo.trim() || undefined,
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
    setSlipNo("");
    clearResults();
    // 選択状態も空に（行が無いので）
    setSelected({});
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
            onChange={e => {setDateFrom(e.target.value); clearResults();}}
            className="border rounded px-2 py-1 ml-1"
          />
        </label>
        <label>
          出荷日(至)
          <input
            type="date"
            value={dateTo}
            onChange={e => {setDateTo(e.target.value); clearResults();}}
            className="border rounded px-2 py-1 ml-1"
          />
        </label>
        <label>
          区分
          <select
            value={movementType}
            onChange={e =>
              {setMovementType(e.target.value as StoreShipmentMovementType | ""); clearResults(); }
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
        <label>
          伝票番号
          <input
            type="text"
            value={slipNo}
            onChange={(e) => {
              setSlipNo(e.target.value);
              clearResults();
            }}
            className="border rounded px-2 py-1 ml-1 w-[140px]"
            placeholder="例: 123（部分一致）"
            inputMode="numeric"
          />
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
      <label>
        出荷元店舗
        <div className="flex items-center gap-2 mt-1">
          <input
            type="text"
            value={storeIdInput}
            readOnly
            className="border rounded px-2 py-1 font-mono w-[110px] bg-slate-50"
          />
          <button
            type="button"
            className="border rounded px-3 py-1"
            onClick={() => { setStoreKeyword(""); setStoreModalOpen(true); }}
          >
            選択
          </button>
          {storeName && (
            <span className="text-slate-600 text-xs truncate max-w-[240px]">
              {storeName}
            </span>
          )}
        </div>
      </label>
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
      {storeModalOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded shadow w-[720px] max-w-[95vw] p-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="font-semibold">出荷元店舗を選択</div>
              <button
                className="ml-auto border rounded px-3 py-1"
                onClick={() => setStoreModalOpen(false)}
              >
                閉じる
              </button>
            </div>

            <input
              className="border rounded px-2 py-1 w-full mb-2"
              placeholder="店舗ID または 店舗名で検索"
              value={storeKeyword}
              onChange={(e) => setStoreKeyword(e.target.value)}
            />

            {storesLoading ? (
              <div className="text-slate-600 text-sm">読み込み中...</div>
            ) : (
              <div className="max-h-[60vh] overflow-auto border rounded">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr className="[&>th]:px-2 [&>th]:py-1 text-left">
                      <th style={{ width: 110 }}>店舗ID</th>
                      <th>店舗名</th>
                      <th style={{ width: 90 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStores.map((s) => (
                      <tr key={s.id} className="[&>td]:px-2 [&>td]:py-1 border-t">
                        <td className="font-mono">{s.id}</td>
                        <td>{s.name ?? ""}</td>
                        <td>
                          <button
                            className="border rounded px-2 py-0.5 text-xs"
                            onClick={() => {
                              setStoreIdInput(s.id);
                              onChangeStoreId?.(s.id);
                              clearResults();
                              setStoreModalOpen(false);
                            }}
                          >
                            選択
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredStores.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-2 py-6 text-center text-slate-500">
                          該当なし
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
