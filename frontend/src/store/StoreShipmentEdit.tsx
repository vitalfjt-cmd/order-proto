// frontend/src/store/StoreShipmentEdit.tsx
import { useEffect, useState } from "react";
import { toCsvString, downloadCsv } from "../utils/csv";
import { ymd } from "../utils/date"
import {
  fetchStoreShipmentDetail,
  saveStoreShipment,
  type StoreShipmentMovementType,
  type StoreShipmentLine,
  type SaveStoreShipmentPayload,
  listMasterStores,
  type MasterStore,
  listMovableItems,
  type MovableItem,
} from "./storeShipmentsApi";

import { STORE_SHIPMENT_MOVE, STORE_SHIPMENT_MOVE_LABEL } from "../domain/codes"

type Props = {
  storeId: string;              // 出荷元店舗（固定）
  shipmentId: number | null;      // null のとき新規
  onBack: () => void;
};

type LineForm = {
  key: string;                  // React 用キー
  itemId: string;
  itemName: string;   // ★追加（表示＆CSV用）
  qty: string;                  // 入力値（文字列）
  unit: string;
  memo: string;
};

export function StoreShipmentEdit({ storeId, shipmentId, onBack }: Props) {
  const today = ymd(new Date());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shipmentDate, setShipmentDate] = useState(today);
  const [movementType, setMovementType] =
    useState<StoreShipmentMovementType>("TRANSFER");
  const [toStoreId, setToStoreId] = useState("");
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<LineForm[]>([]);
  // 出荷先店舗モーダル
  const [toStoreModalOpen, setToStoreModalOpen] = useState(false);
  const [storeKeyword, setStoreKeyword] = useState("");
  const [stores, setStores] = useState<MasterStore[]>([]);
  const [storesLoading, setStoresLoading] = useState(false);

  useEffect(() => {
    if (!toStoreModalOpen) return;
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
  }, [toStoreModalOpen]);

  const toStoreName = stores.find((s) => s.id === toStoreId)?.name ?? null;
  const filteredStores = stores.filter((s) => {
    const k = storeKeyword.trim();
    if (!k) return true;
    return s.id.includes(k) || (s.name ?? "").includes(k);
  });

  // 品目モーダル（在庫>0）
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemKeyword, setItemKeyword] = useState("");
  const [itemLoading, setItemLoading] = useState(false);
  const [movableItems, setMovableItems] = useState<MovableItem[]>([]);
  const [pickLineIndex, setPickLineIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!itemModalOpen) return;

    const t = window.setTimeout(() => {
      (async () => {
        setItemLoading(true);
        try {
          const items = await listMovableItems({
            storeId,
            q: itemKeyword.trim() || undefined,
            limit: 200,
          });
          setMovableItems(items);
        } catch (e) {
          console.error(e);
          alert("品目一覧の取得に失敗しました。");
          setMovableItems([]);
        } finally {
          setItemLoading(false);
        }
      })();
    }, 200);

    return () => window.clearTimeout(t);
  }, [itemModalOpen, itemKeyword, storeId]);


  // 編集時: データ取得
  useEffect(() => {
    if (!shipmentId) {
      setLines([{ key: "ln-0", itemId: "", itemName: "", qty: "", unit: "", memo: "" }]);
      setShipmentDate(today);
      setMovementType("TRANSFER");
      setToStoreId("");
      setMemo("");
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const detail = await fetchStoreShipmentDetail(shipmentId);
        setShipmentDate(detail.header.shipmentDate);
        setMovementType(detail.header.movementType);
        setToStoreId(detail.header.toStoreId ?? "");
        setMemo(detail.header.memo ?? "");

        const ls: LineForm[] = (detail.lines ?? []).map((l, idx) => ({
          key: `ln-${l.id ?? idx}`,
          itemId: l.itemId,
          itemName: l.itemName ?? "",   // ★追加（Bを入れたら l.itemName でOK）
          qty: String(l.qty ?? ""),
          unit: l.unit ?? "",
          memo: l.memo ?? "",
        }));
        setLines(ls.length ? ls : [{ key: "ln-0", itemId: "",itemName: "", qty: "", unit: "", memo: "" }]);
        // setLines([{ key: "ln-0", itemId: "", itemName: "", qty: "", unit: "", memo: "" }]);

      } catch (e) {
        console.error(e);
        alert("店舗出荷データの取得に失敗しました。");
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipmentId]);

  function addLine() {
    setLines(prev => [
      ...prev,
      { key: `ln-${Date.now()}-${prev.length}`, itemId: "",itemName: "", qty: "", unit: "", memo: "" },
    ]);
  }

  function removeLine(idx: number) {
    setLines(prev => {
      if (prev.length <= 1) {
        // 最低1行は残す
        return [{ ...prev[0], itemId: "", itemName: "",qty: "", unit: "", memo: "" }];
      }
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });
  }

  function handleCsvDownload() {
    // 画面入力中の lines を CSV 化（保存不要）
    const parsed = lines
      .map((ln, idx) => {
        const itemId = ln.itemId.trim();
        const qtyNum = Number(ln.qty || "0");
        return {
          lineNo: idx + 1,
          itemId,
          itemName: ln.itemName ?? "",   // ★ここ
          qty: qtyNum,
          unit: ln.unit.trim() || "",
          lineMemo: ln.memo.trim() || "",
        };
      })
      .filter((l) => l.itemId && Number.isFinite(l.qty) && l.qty > 0);

    if (parsed.length === 0) {
      alert("CSV出力する明細がありません（品目/数量を入力してください）。");
      return;
    }

    const header = [
      "伝票ID",
      "出荷元店舗",
      "出荷日",
      "区分",
      "出荷先店舗",
      "ヘッダメモ",
      "行No",
      "品目ID",
      "品目名",
      "数量",
      "単位",
      "明細メモ",
    ];

    const body: (string | number)[][] = parsed.map((l) => [
      shipmentId ?? "",
      storeId,
      shipmentDate,
      movementType,
      movementType === "TRANSFER" ? (toStoreId || "") : "",
      memo || "",
      l.lineNo,
      l.itemId,
      l.itemName,
      l.qty,
      l.unit,
      l.lineMemo,
    ]);

    const csv = toCsvString([header, ...body], { delimiter: "," });

    const ymd = shipmentDate.replace(/-/g, "");
    const idPart = shipmentId ? String(shipmentId) : "new";
    downloadCsv(`store_shipment_${storeId}_${ymd}_${idPart}.csv`, csv);
  }


  async function handleSave(confirmAfterSave: boolean) {
    // 簡易バリデーション
    if (movementType === "TRANSFER") {
      if (!toStoreId.trim()) {
        alert("店舗移動の場合、出荷先店舗IDを入力してください。");
        return;
      }
    }

    const parsedLines: StoreShipmentLine[] = lines
      .map((ln, idx) => {
        const itemId = ln.itemId.trim();
        const qtyNum = Number(ln.qty || "0");
        return {
          itemId,
          qty: qtyNum,
          unit: ln.unit.trim() || null,
          memo: ln.memo.trim() || null,
          lineNo: idx + 1,
        };
      })
      .filter(l => l.itemId && Number.isFinite(l.qty) && l.qty > 0);

    if (!parsedLines.length) {
      alert("数量が1以上の明細を1行以上入力してください。");
      return;
    }

    const payload: SaveStoreShipmentPayload = {
      header: {
        id: shipmentId ?? undefined,
        fromStoreId: storeId,
        toStoreId: movementType === "TRANSFER" ? toStoreId.trim() || null : null,
        movementType,
        shipmentDate,
        memo: memo.trim() || null,
      },
      lines: parsedLines,
    };

    setSaving(true);
    try {
      const res = await saveStoreShipment(payload);
      if (!res.ok) {
        alert("保存に失敗しました。");
        return;
      }
      alert(`保存しました（ID: ${res.shipmentId}）`);

      if (confirmAfterSave) {
        // 確定は一覧側の一括確定で行う想定にしておく
        // 必要であればここで confirm API を呼ぶことも可能
      }

      onBack();
    } catch (e) {
      console.error(e);
      alert("保存時にエラーが発生しました。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-3">
      <h1 className="text-xl font-bold mb-3">
        店舗出荷入力（{shipmentId ? `ID: ${shipmentId}` : "新規"}）
      </h1>

      {loading ? (
        <div className="text-slate-600">読み込み中...</div>
      ) : (
        <>
          {/* ヘッダ部 */}
          <div className="grid gap-3 md:grid-cols-3 mb-4 text-sm">
            <div>
              <div className="text-slate-600 mb-1">出荷元店舗</div>
              <div className="px-2 py-1 border rounded bg-slate-50 font-mono">
                {storeId}
              </div>
            </div>
            <div>
              <label className="block text-slate-600 mb-1">
                出荷日（営業日付）
              </label>
              <input
                type="date"
                value={shipmentDate}
                onChange={e => setShipmentDate(e.target.value)}
                className="border rounded px-2 py-1 w-full"
              />
            </div>
            <div>
              <label className="block text-slate-600 mb-1">区分</label>
              <select
                value={movementType}
                onChange={e =>
                  setMovementType(e.target.value as StoreShipmentMovementType)
                }
                className="border rounded px-2 py-1 w-full"
              >
                {STORE_SHIPMENT_MOVE.map((mt) => (
                  <option key={mt} value={mt}>
                    {STORE_SHIPMENT_MOVE_LABEL[mt]}
                  </option>
                ))}
             </select>
            </div>
            <label className="block text-slate-600 mb-1">
              出荷先店舗（店舗移動時）
            </label>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={toStoreId}
                readOnly
                className="border rounded px-2 py-1 w-full font-mono bg-slate-50"
                placeholder="0003"
                disabled={movementType === "DISPOSAL"}
              />
              <button
                type="button"
                className="border rounded px-3 py-1"
                disabled={movementType === "DISPOSAL"}
                onClick={() => {
                  setStoreKeyword("");
                  setToStoreModalOpen(true);
                }}
              >
                選択
              </button>
            </div>
            {toStoreName && (
              <div className="text-xs text-slate-500 mt-1 truncate">{toStoreName}</div>
            )}

            <div className="md:col-span-2">
              <label className="block text-slate-600 mb-1">メモ</label>
              <textarea
                value={memo}
                onChange={e => setMemo(e.target.value)}
                className="border rounded px-2 py-1 w-full min-h-[40px]"
              />
            </div>
          </div>

          {/* 明細部 */}
          <div className="mb-2 flex justify-between items-center">
            <div className="text-sm font-semibold">明細</div>
            <button
              type="button"
              className="border rounded px-3 py-1 text-sm"
              onClick={addLine}
            >
              行追加
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse table-fixed text-sm">
              <colgroup>
                <col style={{ width: 60 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 80 }} />
                <col />
                <col style={{ width: 60 }} />
              </colgroup>
              <thead>
                <tr className="[&>th]:border-b [&>th]:py-1 [&>th]:px-2 bg-slate-50">
                  <th>#</th>
                  <th>品目コード</th>
                  <th>数量</th>
                  <th>単位</th>
                  <th>備考</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((ln, idx) => (
                  <tr
                    key={ln.key}
                    className="[&>td]:border-b [&>td]:py-1 [&>td]:px-2"
                  >
                    <td className="text-center">{idx + 1}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={ln.itemId}
                          onChange={(e) => {
                            const v = e.target.value;
                            setLines(prev => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], itemId: v, itemName: "" }; // ★追加
                              return next;
                            });
                          }}
                          // onChange={e =>
                          //   setLines(prev => {
                          //     const next = [...prev];
                          //     next[idx] = { ...next[idx], itemId: e.target.value };
                          //     return next;
                          //   })
                          // }
                          className="border rounded px-2 py-1 w-full font-mono"
                          placeholder="001234"
                        />
                        <button
                          type="button"
                          className="border rounded px-2 py-0.5 text-xs whitespace-nowrap"
                          onClick={() => {
                            setPickLineIndex(idx);
                            setItemKeyword("");
                            setItemModalOpen(true);
                          }}
                        >
                          選択
                        </button>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {ln.itemName || ""}
                      </div>
                    </td>
                    <td>
                      <input
                        type="text"
                        value={ln.qty}
                        onChange={e =>
                          setLines(prev => {
                            const next = [...prev];
                            // 簡易：数値以外はそのまま入れる（保存時にNumber化）
                            next[idx] = { ...next[idx], qty: e.target.value };
                            return next;
                          })
                        }
                        className="border rounded px-2 py-1 w-full text-right"
                        inputMode="decimal"
                        placeholder="0"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={ln.unit}
                        onChange={e =>
                          setLines(prev => {
                            const next = [...prev];
                            next[idx] = { ...next[idx], unit: e.target.value };
                            return next;
                          })
                        }
                        className="border rounded px-2 py-1 w-full"
                        placeholder="個"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={ln.memo}
                        onChange={e =>
                          setLines(prev => {
                            const next = [...prev];
                            next[idx] = { ...next[idx], memo: e.target.value };
                            return next;
                          })
                        }
                        className="border rounded px-2 py-1 w-full"
                      />
                    </td>
                    <td className="text-center">
                      <button
                        type="button"
                        className="border rounded px-2 py-0.5 text-xs"
                        onClick={() => removeLine(idx)}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* フッタボタン */}
          <div className="mt-4 flex justify-between items-center text-sm">
            <button
              type="button"
              className="border rounded px-3 py-1"
              onClick={onBack}
              disabled={saving}
            >
              一覧に戻る
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                className="border rounded px-3 py-1"
                onClick={handleCsvDownload}
                disabled={saving}
              >
                CSV出力
              </button>
              <button
                type="button"
                className="border rounded px-3 py-1 bg-blue-600 text-white"
                onClick={() => void handleSave(false)}
                disabled={saving}
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </>
      )}
      {/* 出荷先店舗モーダル */}
      {toStoreModalOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded shadow w-[720px] max-w-[95vw] p-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="font-semibold">出荷先店舗を選択</div>
              <button
                className="ml-auto border rounded px-3 py-1"
                onClick={() => setToStoreModalOpen(false)}
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
                              setToStoreId(s.id);
                              setToStoreModalOpen(false);
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

      {/* 品目モーダル（在庫>0） */}
      {itemModalOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded shadow w-[900px] max-w-[95vw] p-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="font-semibold">
                品目を選択（在庫ありのみ） / 出荷元: <span className="font-mono">{storeId}</span>
              </div>
              <button
                className="ml-auto border rounded px-3 py-1"
                onClick={() => setItemModalOpen(false)}
              >
                閉じる
              </button>
            </div>

            <input
              className="border rounded px-2 py-1 w-full mb-2"
              placeholder="品目ID または 品目名で検索"
              value={itemKeyword}
              onChange={(e) => setItemKeyword(e.target.value)}
            />

            {itemLoading ? (
              <div className="text-slate-600 text-sm">読み込み中...</div>
            ) : (
              <div className="max-h-[60vh] overflow-auto border rounded">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr className="[&>th]:px-2 [&>th]:py-1 text-left">
                      <th style={{ width: 110 }}>品目ID</th>
                      <th>品目名</th>
                      <th style={{ width: 110 }}>在庫</th>
                      <th style={{ width: 90 }}>在庫単位</th>
                      <th style={{ width: 90 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {movableItems.map((it) => (
                      <tr key={it.itemId} className="[&>td]:px-2 [&>td]:py-1 border-t">
                        <td className="font-mono">{it.itemId}</td>
                        <td className="truncate" title={it.itemName ?? ""}>
                          {it.itemName ?? ""}
                        </td>
                        <td className="text-right font-mono">{it.onHandQty}</td>
                        <td>{it.stockUnit ?? it.unit ?? ""}</td>
                        <td>
                          <button
                            className="border rounded px-2 py-0.5 text-xs"
                            onClick={() => {
                              if (pickLineIndex === null) return;
                              setLines((prev) => {
                                const next = [...prev];
                                const unit = it.stockUnit ?? it.unit ?? "";
                                next[pickLineIndex] = {
                                  ...next[pickLineIndex],
                                  itemId: it.itemId,
                                  itemName: it.itemName ?? "",   // ★追加
                                  unit: unit || next[pickLineIndex].unit,
                                };
                                return next;
                              });
                              setItemModalOpen(false);
                            }}
                          >
                            選択
                          </button>
                        </td>
                      </tr>
                    ))}
                    {movableItems.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-2 py-6 text-center text-slate-500">
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
