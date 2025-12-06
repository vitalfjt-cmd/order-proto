// frontend/src/store/StoreShipmentEdit.tsx
import React, { useEffect, useState } from "react";
import {
  fetchStoreShipmentDetail,
  saveStoreShipment,
  type StoreShipmentMovementType,
  type StoreShipmentLine,
  type SaveStoreShipmentPayload,
} from "./storeShipmentsApi";

type Props = {
  storeId: string;              // 出荷元店舗（固定）
  headerId: number | null;      // null のとき新規
  onBack: () => void;
};

type LineForm = {
  key: string;                  // React 用キー
  itemId: string;
  qty: string;                  // 入力値（文字列）
  unit: string;
  memo: string;
};

export function StoreShipmentEdit({ storeId, headerId, onBack }: Props) {
  const today = new Date().toISOString().slice(0, 10);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [shipmentDate, setShipmentDate] = useState(today);
  const [movementType, setMovementType] =
    useState<StoreShipmentMovementType>("TRANSFER");
  const [toStoreId, setToStoreId] = useState("");
  const [memo, setMemo] = useState("");

  const [lines, setLines] = useState<LineForm[]>([]);

  // 編集時: データ取得
  useEffect(() => {
    if (!headerId) {
      // 新規：空明細1行だけ用意
      setLines([
        { key: "ln-0", itemId: "", qty: "", unit: "", memo: "" },
      ]);
      setShipmentDate(today);
      setMovementType("TRANSFER");
      setToStoreId("");
      setMemo("");
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const detail = await fetchStoreShipmentDetail(headerId);
        setShipmentDate(detail.header.shipmentDate);
        setMovementType(detail.header.movementType);
        setToStoreId(detail.header.toStoreId ?? "");
        setMemo(detail.header.memo ?? "");

        const ls: LineForm[] = (detail.lines ?? []).map((l, idx) => ({
          key: `ln-${l.id ?? idx}`,
          itemId: l.itemId,
          qty: String(l.qty ?? ""),
          unit: l.unit ?? "",
          memo: l.memo ?? "",
        }));
        setLines(ls.length ? ls : [{ key: "ln-0", itemId: "", qty: "", unit: "", memo: "" }]);
      } catch (e) {
        console.error(e);
        alert("店舗出荷データの取得に失敗しました。");
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerId]);

  function addLine() {
    setLines(prev => [
      ...prev,
      { key: `ln-${Date.now()}-${prev.length}`, itemId: "", qty: "", unit: "", memo: "" },
    ]);
  }

  function removeLine(idx: number) {
    setLines(prev => {
      if (prev.length <= 1) {
        // 最低1行は残す
        return [{ ...prev[0], itemId: "", qty: "", unit: "", memo: "" }];
      }
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });
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
        id: headerId ?? undefined,
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
      alert(`保存しました（ID: ${res.headerId}）`);

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
        店舗出荷入力（{headerId ? `ID: ${headerId}` : "新規"}）
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
                <option value="TRANSFER">店舗移動</option>
                <option value="DISPOSAL">廃棄</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-600 mb-1">
                出荷先店舗ID（店舗移動時）
              </label>
              <input
                type="text"
                value={toStoreId}
                onChange={e => setToStoreId(e.target.value)}
                className="border rounded px-2 py-1 w-full font-mono"
                placeholder="0003"
                disabled={movementType === "DISPOSAL"}
              />
            </div>
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
                      <input
                        type="text"
                        value={ln.itemId}
                        onChange={e =>
                          setLines(prev => {
                            const next = [...prev];
                            next[idx] = { ...next[idx], itemId: e.target.value };
                            return next;
                          })
                        }
                        className="border rounded px-2 py-1 w-full font-mono"
                        placeholder="001234"
                      />
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
    </div>
  );
}
