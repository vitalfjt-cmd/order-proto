// ベンダーが差異を確認・検収取消・編集へ遷移できる一覧です。
// import React, { useMemo, useState } from "react";
import React, { useEffect, useMemo, useState } from "react";
import { searchInspectionsByVendor, unconfirmInspections } from "../inspection/inspectionApi";
import type { InspectionHeader, InspectionLine } from "../inspection/inspectionApi";
import { buildDiscrepancyCsv } from "../inspection/discrepancyCsv";
import { downloadCsv } from "../utils/csv";
import { buildSlipsFromInspections } from "../slips/slipsApi";
import { buildSlipsCsv, openSlipsPrint } from "../slips/slipsCsvPdf";

// ID 正規化（ゼロ埋め固定長）
const ID = {
  vendor: (s: string) => String(s ?? "").replace(/\D/g, "").padStart(6, "0"),
  item:   (s: string) => String(s ?? "").replace(/\D/g, "").padStart(6, "0"),
  store:  (s: string) => String(s ?? "").replace(/\D/g, "").padStart(4, "0"),
};

type Props = {
  vendorIdDefault: string;     // 例: "000001"
  onEdit: (inspectionId: string) => void;
  onBack?: () => void;
};


export function VendorInspectionList(props: Props) {
  const { onEdit, onBack } = props;
  const vendorIdDefault = props.vendorIdDefault ?? "";
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [vendorId, setVendorId] = useState<string>("");
  const [destinationId, setDestinationId] = useState<string>("");

  const [headers, setHeaders] = useState<InspectionHeader[]>([]);
  const [lines, setLines] = useState<InspectionLine[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  // マウント時に一度だけ props の既定値を適用（型は常に string に確定）
  useEffect(() => {
    setVendorId(vendorIdDefault ?? "");
    // vendorIdDefault が将来変わっても追従したい場合は依存配列に vendorIdDefault を入れてください
    // 例: [vendorIdDefault]
  }, []);

  async function doSearch(): Promise<void> {
    // vendorIdParam は空文字時は未指定扱い（API側で全件検索）
    const vendorIdParam: string = vendorId && vendorId.trim() !== "" ? ID.vendor(vendorId) : "";
    const res = await searchInspectionsByVendor({
      from: from || undefined,
      to: to || undefined,
      vendorId: vendorIdParam,                       // ← string を保証
      destinationId: destinationId ? ID.store(destinationId) : undefined,
    });
    setHeaders(res.headers);
    setLines(res.lines);
    const initSel: Record<string, boolean> = {};
    for (const h of res.headers) initSel[h.id] = false;
    setSelected(initSel);
  }

  function diffOfHeader(hid: string): number {
    return lines.filter(l => l.headerId === hid)
                .reduce((s, l) => s + (Number(l.inspectQty||0) - Number(l.shipQty||0)), 0);
  }

  const totals = useMemo(() => {
    const cnt = headers.length;
    const totalDiff = headers.reduce((s, h) => s + diffOfHeader(h.id), 0);
    return { cnt, totalDiff };
  }, [headers, lines]);

  async function handleUnconfirm(): Promise<void> {
    const ids = headers.filter(h => selected[h.id] && h.status === "confirmed").map(h => h.id);
    if (ids.length === 0) { alert("取消対象（confirmed）が選択されていません。"); return; }
    if (!confirm(`${ids.length}件の検収を取り消します。よろしいですか？`)) return;
    await unconfirmInspections(ids);
    await doSearch();
  }

  function handleCsv(): void {
    const selIds = headers.filter(h => selected[h.id]).map(h => h.id);
    const csv = buildDiscrepancyCsv(headers, lines, {
      headerIds: selIds.length ? selIds : undefined,
      includeHeader: true,
      delimiter: ",",
    });
    const stamp = new Date().toISOString().slice(0,19).replace(/[-:T]/g,"");
    downloadCsv(`vendor_discrepancy_${vendorId}_${stamp}.csv`, csv);
  }

  return (
    <div className="p-4 space-y-3">
      <h1 className="text-xl font-bold">検品差異（ベンダー）</h1>
      <div className="flex flex-wrap items-end gap-3">
        {onBack && <button className="border rounded px-3 py-1" onClick={onBack}>← 戻る</button>}
        <label>期間From <input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="border rounded px-2 py-1"/></label>
        <label>To <input type="date" value={to} onChange={e=>setTo(e.target.value)} className="border rounded px-2 py-1"/></label>
        <label>ベンダー <input value={vendorId} onChange={e=>setVendorId(e.target.value)} className="border rounded px-2 py-1 w-28" /></label>
        <label>納品先（任意）<input value={destinationId} onChange={e=>setDestinationId(e.target.value)} className="border rounded px-2 py-1 w-28" /></label>
        <button className="border rounded px-3 py-1" onClick={doSearch}>検索</button>
        <button
          className="border rounded px-3 py-1"
          onClick={() => {
            const selIds = headers.filter(h => selected[h.id]).map(h => h.id);
            const slips = buildSlipsFromInspections(headers, lines, { headerIds: selIds.length ? selIds : undefined });
            if (slips.length === 0) { alert("差異がないため、発行対象の伝票がありません。"); return; }
            const csv = buildSlipsCsv(slips, { includeHeader: true, delimiter: "," });
            const stamp = new Date().toISOString().slice(0,19).replace(/[-:T]/g,"");
            downloadCsv(`slips_${vendorId}_${stamp}.csv`, csv);
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


        <div className="ml-auto flex items-center gap-3">
          <span>件数: <b>{totals.cnt}</b></span>
          <span>差異合計: <b>{totals.totalDiff}</b></span>
          <button className="border rounded px-3 py-1" onClick={handleCsv} disabled={headers.length===0}>差異CSV</button>
          <button className="border rounded px-3 py-1" onClick={handleUnconfirm} disabled={headers.every(h => !(selected[h.id] && h.status==="confirmed"))}>
            選択を検収取消
          </button>
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
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>納品先</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>状態</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px", textAlign:"right" }}>差異</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {headers.map((h) => {
              const isConfirmed = h.status === "confirmed";
              const diff = diffOfHeader(h.id);
              return (
                <tr key={h.id} style={{ borderBottom:"1px solid #e2e8f0", opacity: isConfirmed ? 0.85 : 1 }}>
                  <td style={{ padding:"6px 8px", textAlign:"center" }}>
                    <input type="checkbox" checked={!!selected[h.id]} onChange={(e)=> setSelected(prev => ({ ...prev, [h.id]: e.target.checked }))} />
                  </td>
                  <td style={{ padding:"6px 8px" }}>{h.deliveryDate}</td>
                  <td style={{ padding:"6px 8px" }}>{h.destinationId} {h.destinationName || ""}</td>
                  <td style={{ padding:"6px 8px" }}>{h.status}</td>
                  <td style={{ padding:"6px 8px", textAlign:"right" }}>{diff}</td>
                  <td style={{ padding:"6px 8px" }}>
                    <button
                      className="border rounded px-2 py-1"
                      onClick={() => onEdit(h.id)}
                      title={isConfirmed ? "編集するには『検収取消』後に行ってください" : "編集"}
                      disabled={isConfirmed}
                    >
                      編集
                    </button>
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
