// src/inspection/InspectionEdit.tsx

import React, { useEffect, useMemo, useState } from "react";
import { getInspection, saveInspectionLines } from "./inspectionApi";
import type { InspectionHeader, InspectionLine } from "./inspectionApi";
import { logEvent } from "../auditlog";

type Props = {
  headerId: string;
  onBack: () => void;
  ownerId?: string; // 店舗ID（任意：ログ用）
};

type LineView = InspectionLine & {
  itemName?: string;
};

export function InspectionEdit({ headerId, onBack, ownerId }: Props) {
  const [header, setHeader] = useState<InspectionHeader | null>(null);
  const [lines, setLines] = useState<LineView[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  // 読み込み
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await getInspection(headerId);
        if (cancelled) return;
        setHeader(res.header);
        setLines(res.lines);
      } catch (e) {
        console.error("[InspectionEdit] load error:", e);
        if (!cancelled) alert("検品データの読み込みに失敗しました。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [headerId]);

  const isLocked = header ? header.status !== "open" : false;

  // 数量更新（inspectedQty と diffQty を同時更新）
  function setQty(index: number, v: number): void {
    setLines((prev) =>
      prev.map((l, i) =>
        i === index
          ? {
              ...l,
              inspectedQty: v,
              diffQty: v - Number(l.shipQty ?? 0),
            }
          : l
      )
    );
  }

  async function handleSave(): Promise<void> {
    if (!header) {
      alert("ヘッダ情報がありません。");
      return;
    }
    if (saving) return;

    try {
      setSaving(true);

      const payload = lines.map((l) => ({
        id: l.id,
        inspectedQty: Number(l.inspectedQty ?? 0),
        lotNo: l.lotNo ?? null,
        note: l.note ?? null,
      }));

      await saveInspectionLines(header.id, payload);

      const ownerIdResolved = ownerId ?? header.ownerId;

      // ログ
      logEvent({
        type: "inspection.save",
        headerId: String(header.id),
        ownerId: ownerIdResolved,
        vendorId: header.vendorId,
        destinationId: header.destinationId,
        destinationName: header.destinationName,
        deliveryDate: header.deliveryDate,
        memo: "検品内容保存",
      });

      alert("保存しました");
    } catch (e) {
      console.error("[InspectionEdit] save error:", e);
      alert("検品内容の保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  const subtotal = useMemo<number>(
    () =>
      lines.reduce(
        (s, l) => s + Number(l.inspectedQty ?? 0),
        0
      ),
    [lines]
  );

  return (
    <div className="p-4 space-y-3">
      <h1 className="text-xl font-bold">検品編集</h1>

      <div className="flex justify-between items-center">
        {header ? (
          <div className="text-sm text-slate-600">
            検品ID: {header.id} /納品日: {header.deliveryDate}
            / ベンダー: {header.vendorId}{" "}
            / 納品先: {header.destinationId}{" "}
            {header.destinationName ?? ""} / 状態: {header.status}
          </div>
        ) : (
          <div className="text-sm text-slate-600">読み込み中...</div>
        )}
        <button className="border rounded px-3 py-1" onClick={onBack}>
          一覧へ戻る
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-slate-600">読込中...</div>
      ) : (
        <>
          <div style={{ overflow: "auto", maxHeight: "60vh" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th
                    style={{
                      borderBottom: "1px solid #e2e8f0",
                      padding: "6px 8px",
                    }}
                  >
                    品目
                  </th>
                  <th
                    style={{
                      borderBottom: "1px solid #e2e8f0",
                      padding: "6px 8px",
                    }}
                  >
                    ロット
                  </th>
                  <th
                    style={{
                      borderBottom: "1px solid #e2e8f0",
                      padding: "6px 8px",
                      textAlign: "right",
                    }}
                  >
                    出荷数
                  </th>
                  <th
                    style={{
                      borderBottom: "1px solid #e2e8f0",
                      padding: "6px 8px",
                      textAlign: "right",
                    }}
                  >
                    検品数
                  </th>
                  <th
                    style={{
                      borderBottom: "1px solid #e2e8f0",
                      padding: "6px 8px",
                      textAlign: "right",
                    }}
                  >
                    差異
                  </th>
                  <th
                    style={{
                      borderBottom: "1px solid #e2e8f0",
                      padding: "6px 8px",
                    }}
                  >
                    備考
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.id}>
                    <td
                      style={{
                        borderBottom: "1px solid #e2e8f0",
                        padding: "6px 8px",
                      }}
                    >
                      {l.itemId} {l.itemName ?? ""}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #e2e8f0",
                        padding: "6px 8px",
                      }}
                    >
                      <input
                        value={l.lotNo ?? ""}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((x, idx) =>
                              idx === i
                                ? { ...x, lotNo: e.target.value }
                                : x
                            )
                          )
                        }
                        className="border rounded px-2 py-1 w-28"
                        disabled={isLocked}
                      />
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #e2e8f0",
                        padding: "6px 8px",
                        textAlign: "right",
                      }}
                    >
                      {l.shipQty}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #e2e8f0",
                        padding: "6px 8px",
                        textAlign: "right",
                      }}
                    >
                      <input
                        type="number"
                        value={l.inspectedQty ?? ""}
                        onChange={(e) =>
                          setQty(i, Number(e.target.value || 0))
                        }
                        className="border rounded px-2 py-1 w-24 text-right"
                        disabled={isLocked}
                      />
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #e2e8f0",
                        padding: "6px 8px",
                        textAlign: "right",
                      }}
                    >
                      {l.diffQty}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #e2e8f0",
                        padding: "6px 8px",
                      }}
                    >
                      <input
                        value={l.note ?? ""}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((x, idx) =>
                              idx === i
                                ? { ...x, note: e.target.value }
                                : x
                            )
                          )
                        }
                        className="border rounded px-2 py-1 w-40"
                        disabled={isLocked}
                      />
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      style={{ padding: "8px", color: "#64748b" }}
                    >
                      明細がありません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center mt-2">
            <div className="text-sm text-slate-600">
              検品数合計: {subtotal}
            </div>
            <button
              className="border rounded px-4 py-1"
              onClick={handleSave}
              disabled={saving || isLocked}
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
