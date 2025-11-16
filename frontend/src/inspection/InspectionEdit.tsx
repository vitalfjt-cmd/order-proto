import React, { useEffect, useMemo, useState } from "react";
import { getInspection, saveInspectionLines } from "./inspectionApi";
import type { InspectionHeader, InspectionLine } from "./inspectionApi";
import { logEvent } from "../auditlog";

type Props = {
  headerId: string;
  onBack: () => void;
  ownerId?: string; // 追加（任意）
};

export function InspectionEdit({ headerId, onBack, ownerId }: Props) {
  const [header, setHeader] = useState<InspectionHeader | null>(null);
  const [lines, setLines] = useState<InspectionLine[]>([]);
  // コンポーネント内のどこかで
  const q = new URLSearchParams((location.hash.split("?")[1] || ""));
  const ownerIdFromQuery = q.get("ownerId") || "";
  const ownerIdResolved = ownerId ?? ownerIdFromQuery;  // ← これをログに使う

  useEffect(() => {
    (async () => {
      const res = await getInspection(headerId);
      setHeader(res.header);
      setLines(res.lines);
    })();
  }, [headerId]);

  const isLocked = header?.status === "confirmed";


  function setQty(i: number, v: number): void {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, inspectQty: v } : l));
  }

  async function handleSave(): Promise<void> {
    await saveInspectionLines(
      headerId,
      lines.map(l => ({
        lineId: l.lineId,
        inspectQty: Number(l.inspectQty || 0),
        lotNo: l.lotNo,
        note: l.note,
      }))
    );

    if (header) { // ★nullガード
      logEvent({
        type: "inspection.save",
        headerId: header.id,
        ownerId: ownerIdResolved,
        vendorId: header.vendorId,
        destinationId: header.destinationId,
        destinationName: header.destinationName,
        deliveryDate: header.deliveryDate,
        memo: "検品内容保存",
      });
    }

    alert("保存しました");
  }


  const subtotal = useMemo<number>(() => lines.reduce((s, l) => s + Number(l.inspectQty || 0), 0), [lines]);

  return (
    <div className="p-4 space-y-3">
      <h1 className="text-xl font-bold">検品編集</h1>
      <div className="flex justify-between items-center">
        {header
          ? <div className="text-sm text-slate-600">納品日: {header.deliveryDate} / ベンダー: {header.vendorId} / 納品先: {header.destinationId} {header.destinationName||""} / 状態: {header.status}</div>
          : <div className="text-sm text-slate-600">読み込み中...</div>
        }
        <button className="border rounded px-3 py-1" onClick={onBack}>一覧へ戻る</button>
      </div>

      <div style={{ overflow: "auto", maxHeight: "60vh" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>品目</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>ロット</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px", textAlign:"right" }}>出荷数</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px", textAlign:"right" }}>検品数</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>単位</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>備考</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.lineId}>
                <td style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>{l.itemId} {l.itemName}</td>
                <td style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>
                  <input
                    value={l.lotNo || ""}
                    onChange={(e)=> setLines(prev => prev.map((x, idx) => idx===i ? { ...x, lotNo: e.target.value } : x))}
                    className="border rounded px-2 py-1 w-28"
                    disabled={isLocked}
                  />
                </td>
                <td style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px", textAlign:"right" }}>{l.shipQty}</td>
                <td style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px", textAlign:"right" }}>
                  <input
                    type="number"
                    value={l.inspectQty}
                    onChange={(e)=> setQty(i, Number(e.target.value))}
                    onKeyDown={(e)=> { if (e.key === "Enter") {
                      const nx = document.querySelector<HTMLInputElement>(`input[data-idx='${i+1}']`); nx?.focus();
                    }}}
                    data-idx={i}
                    className="border rounded px-2 py-1 w-24"
                    style={{ textAlign:"right" }}
                    disabled={isLocked}
                  />
                </td>
                <td style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>{l.unit}</td>
                <td style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>
                  <input
                    value={l.note || ""}
                    onChange={(e)=> setLines(prev => prev.map((x, idx) => idx===i ? { ...x, note: e.target.value } : x))}
                    className="border rounded px-2 py-1 w-40"
                    disabled={isLocked}
                  />
                </td>
              </tr>
            ))}
            {lines.length === 0 && <tr><td colSpan={6} style={{ color:"#64748b", padding:"8px" }}>明細がありません。</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end items-center gap-6">
        <div>検品数合計: <b>{subtotal}</b></div>
        <button className="border rounded px-3 py-1" onClick={handleSave} disabled={isLocked}>保存</button>
      </div>
    </div>
  );
}
