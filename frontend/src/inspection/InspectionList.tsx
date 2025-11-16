import React, { useMemo, useState } from "react";
import { searchInspections, confirmInspections } from "./inspectionApi";
import type { OwnerType, InspectionHeader, InspectionLine } from "./inspectionApi";
import { buildDiscrepancyCsv } from "./discrepancyCsv";
import { downloadCsv } from "../utils/csv";
import { buildSlipsFromInspections } from "../slips/slipsApi";
import { buildSlipsCsv, openSlipsPrint } from "../slips/slipsCsvPdf";
import { logEvent } from "../auditlog";

type Props = {
  ownerType: OwnerType;   // "STORE" | "DC"
  ownerId: string;        // 例: "0001" / "DC01"
  onEdit: (headerId: string) => void;
  onBack?: () => void;
};

export function InspectionList({ ownerType, ownerId, onEdit, onBack }: Props) {
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [vendorId, setVendorId] = useState<string>("");

  const [headers, setHeaders] = useState<InspectionHeader[]>([]);
  const [lines, setLines] = useState<InspectionLine[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  async function doSearch(): Promise<void> {
       const normalize = (s: string, width: number) => {
         const digits = String(s || "").replace(/\D/g, "");
         return digits ? digits.padStart(width, "0") : "";
       };
       const vId = vendorId ? normalize(vendorId, 6) : "";
    const res = await searchInspections({ 
      // from, to, vendorId: vendorId || undefined, ownerType, ownerId 
           from, to,
           vendorId: vId || undefined,
           ownerType, ownerId
    });
    setHeaders(res.headers);
    setLines(res.lines);
    const initSel: Record<string, boolean> = {};
    for (const h of res.headers) initSel[h.id] = false;
    setSelected(initSel);
  }

  function toggleOne(id: string, on: boolean): void {
    setSelected(prev => ({ ...prev, [id]: on }));
  }

  async function handleConfirm(): Promise<void> {
    const targets = headers.filter(h => selected[h.id] && h.status === "open");
    const ids = targets.map(h => h.id);
    if (ids.length === 0) { alert("検収対象（open）が選択されていません。"); return; }
    if (!confirm(`${ids.length}件を検収確定します。よろしいですか？`)) return;

    await confirmInspections(ids);

    // ★ 各伝票ごとに記録
    for (const h of targets) {
      logEvent({
        type: "inspection.confirm",
        headerId: h.id,
        ownerId: ownerId,            // ← この一覧コンポーネントが持っている ownerId を使用
        vendorId: h.vendorId,
        destinationId: h.destinationId,
        destinationName: h.destinationName,
        deliveryDate: h.deliveryDate,
        memo: "検収確定",
      });
    }

    await doSearch();
  }

  const totals = useMemo<{ cnt: number; ship: number; insp: number }>(() => {
    const cnt = headers.length;
    const bySel = new Set(headers.filter(h => selected[h.id]).map(h => h.id));
    const ship = lines.filter(l => bySel.size === 0 || bySel.has(l.headerId))
                      .reduce((s, l) => s + Number(l.shipQty || 0), 0);
    const insp = lines.filter(l => bySel.size === 0 || bySel.has(l.headerId))
                      .reduce((s, l) => s + Number(l.inspectQty || 0), 0);
    return { cnt, ship, insp };
  }, [headers, lines, selected]);

  return (
    <div className="p-4 space-y-3">
      <h1 className="text-xl font-bold">検品一覧（{ownerType}:{ownerId}）</h1>
      <div className="flex flex-wrap items-end gap-3">
        {onBack && <button className="border rounded px-3 py-1" onClick={onBack}>← 戻る</button>}
        <label>期間From <input type="date" value={from} onChange={(e)=>setFrom(e.target.value)} className="border rounded px-2 py-1"/></label>
        <label>To <input type="date" value={to} onChange={(e)=>setTo(e.target.value)} className="border rounded px-2 py-1"/></label>
        <label>ベンダー <input value={vendorId} onChange={(e)=>setVendorId(e.target.value)} className="border rounded px-2 py-1 w-28"/></label>
        <button className="border rounded px-3 py-1" onClick={doSearch}>検索</button>
        <button
          className="border rounded px-3 py-1"
          onClick={() => {
            const selIds = headers.filter(h => selected[h.id]).map(h => h.id);
            const csv = buildDiscrepancyCsv(headers, lines, {
              headerIds: selIds.length ? selIds : undefined,
              includeHeader: true,
              delimiter: ",",
            });
            const ext = "csv";
            const stamp = new Date().toISOString().slice(0,19).replace(/[-:T]/g,"");
            downloadCsv(`discrepancy_${ownerType}_${ownerId}_${stamp}.${ext}`, csv);
          }}
          disabled={headers.length===0}
        >
          差異CSV
        </button>
        {ownerType === "DC" && (
          <>
            <button
              className="border rounded px-3 py-1"
              onClick={() => {
                const selIds = headers.filter(h => selected[h.id]).map(h => h.id);
                const slips = buildSlipsFromInspections(headers, lines, { headerIds: selIds.length ? selIds : undefined });
                if (slips.length === 0) { alert("差異がないため、発行対象の伝票がありません。"); return; }
                const csv = buildSlipsCsv(slips, { includeHeader: true, delimiter: "," });
                const stamp = new Date().toISOString().slice(0,19).replace(/[-:T]/g,"");
                downloadCsv(`slips_DC_${ownerId}_${stamp}.csv`, csv);
              }}
              disabled={headers.length===0}
            >
              伝票発行CSV
            </button>
            <button
              className="border rounded px-3 py-1"
              onClick={() => {
                const selIds = headers.filter(h => selected[h.id]).map(h => h.id);
                const slips = buildSlipsFromInspections(headers, lines, { headerIds: selIds.length ? selIds : undefined });
                if (slips.length === 0) { alert("差異がないため、発行対象の伝票がありません。"); return; }
                openSlipsPrint(slips);
              }}
              disabled={headers.length===0}
            >
              伝票発行PDF
            </button>
          </>
        )}

        <div className="ml-auto flex items-center gap-4">
          <span>件数: <b>{totals.cnt}</b></span>
          <span>出荷数合計: <b>{totals.ship}</b></span>
          <span>検品数合計: <b>{totals.insp}</b></span>
          <button className="border rounded px-3 py-1" onClick={handleConfirm} disabled={headers.every(h => !(selected[h.id] && h.status==="open"))}>選択を検収確定</button>
        </div>
      </div>

      <div style={{ overflow:"auto", maxHeight:"60vh" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>
                <input
                  type="checkbox"
                  onChange={(e)=> {
                    const on = e.target.checked;
                    const next: Record<string, boolean> = {};
                    for (const h of headers) next[h.id] = on;
                    setSelected(next);
                  }}
                  checked={headers.length>0 && headers.every(h => selected[h.id])}
                />
              </th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>納品日</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>ベンダー</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>納品先</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>状態</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {headers.map((h: InspectionHeader) => {
              const isConfirmed = h.status === "confirmed";
              return (
                <tr key={h.id} style={{ borderBottom:"1px solid #e2e8f0", opacity: isConfirmed ? 0.65 : 1 }}>
                  <td style={{ padding:"6px 8px", textAlign:"center" }}>
                    <input type="checkbox" checked={!!selected[h.id]} onChange={(e)=>toggleOne(h.id, e.target.checked)} />
                  </td>
                  <td style={{ padding:"6px 8px" }}>{h.deliveryDate}</td>
                  <td style={{ padding:"6px 8px" }}>{h.vendorId}</td>
                  <td style={{ padding:"6px 8px" }}>{h.destinationId} {h.destinationName || ""}</td>
                  <td style={{ padding:"6px 8px" }}>{h.status}</td>
                  <td style={{ padding:"6px 8px" }}>
                    <button className="border rounded px-2 py-1" onClick={()=>onEdit(h.id)} disabled={isConfirmed} title={isConfirmed ? "検収済みは編集できません" : "編集"}>編集</button>
                  </td>
                </tr>
              );
            })}
            {headers.length === 0 && <tr><td colSpan={6} style={{ color:"#64748b", padding:"8px" }}>データがありません。</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
