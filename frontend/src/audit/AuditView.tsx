// src/audit/AuditView.tsx
import React, { useEffect, useState } from "react";
import { searchAudit, type AuditEvent, type AuditEventType } from "../auditlog";
import { downloadAuditCsv } from "./auditCsv";




const TYPES: AuditEventType[] = [
  "shipment.confirm",
  "shipment.unconfirm",
  "shipment.save",
  "inspection.confirm",
  "inspection.unconfirm",
  "inspection.save",
];

export default function AuditView() {
  const today = new Date().toISOString().slice(0,10);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [actor, setActor] = useState("");
  const [type, setType] = useState<AuditEventType | "">("");
  const [headerId, setHeaderId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [destinationId, setDestinationId] = useState("");

  const [rows, setRows] = useState<AuditEvent[]>([]);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<AuditEvent | null>(null);
    useEffect(() => { doSearch(); }, []);

  function doSearch() {
    const res = searchAudit({
      dateFrom, dateTo,
      actor: actor || undefined,
      type: (type || undefined) as AuditEventType | undefined,
      headerId: headerId || undefined,
      vendorId: vendorId || undefined,
      destinationId: destinationId || undefined,
    });
    setRows(res);
  }

  return (
    <div className="p-3">
      <h1 className="text-xl font-bold mb-3">監査ログ（モック）</h1>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label>日付(自)
          <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className="border rounded px-2 py-1"/>
        </label>
        <label>日付(至)
          <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} className="border rounded px-2 py-1"/>
        </label>
        <label>ユーザー
          <input value={actor} onChange={e=>setActor(e.target.value)} className="border rounded px-2 py-1 w-28"/>
        </label>
        <label>種別
          <select value={type} onChange={e=>setType(e.target.value as AuditEventType | "")} className="border rounded px-2 py-1">
            <option value="">(すべて)</option>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>伝票番号
          <input value={headerId} onChange={e=>setHeaderId(e.target.value)} className="border rounded px-2 py-1 w-44" placeholder="VOH-..." />
        </label>
        <label>ベンダー
          <input value={vendorId} onChange={e=>setVendorId(e.target.value)} className="border rounded px-2 py-1 w-28" />
        </label>
        <label>納品先
          <input value={destinationId} onChange={e=>setDestinationId(e.target.value)} className="border rounded px-2 py-1 w-28" />
        </label>

        <button className="border rounded px-3 py-1" onClick={doSearch}>検索</button>
        <button
          className="border rounded px-3 py-1"
          onClick={() => {
            downloadAuditCsv(rows, {
              includeHeader: true,
              delimiter: ",", // 必要なら "\t"
              filename: `audit_${dateFrom}_${dateTo}.csv`,
            });
          }}
        >
          CSVダウンロード
        </button>
        <button className="border rounded px-3 py-1"
          onClick={() => { setDateFrom(today); setDateTo(today); setActor(""); setType(""); setHeaderId(""); setVendorId(""); setDestinationId(""); setRows(searchAudit({ dateFrom: today, dateTo: today })); }}
        >
          条件リセット
        </button>
      </div>

      <table className="w-full border-collapse table-fixed">
        <colgroup>
          <col style={{width: 180}}/>
          <col style={{width: 120}}/>
          <col style={{width: 140}}/>
          <col style={{width: 140}}/>
          <col style={{width: 160}}/>
          <col style={{width: 120}}/>
          <col style={{width: 120}}/>
          <col />
        </colgroup>
        <thead>
          <tr className="[&>th]:border-b [&>th]:py-1 [&>th]:px-2 text-sm bg-slate-50">
            <th>日時</th>
            <th>ユーザー</th>
            <th>種別</th>
            <th>伝票番号</th>
            <th>納品先</th>
            <th>ベンダー</th>
            <th>納品日</th>
            <th>メモ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr
              key={r.id}
              className="[&>td]:border-b [&>td]:py-1 [&>td]:px-2 text-sm hover:bg-slate-50 cursor-pointer"
              onClick={() => { setSelected(r); setDetailOpen(true); }}
              title="クリックで詳細表示"
            >
              <td>{r.at.replace("T"," ").replace("Z","")}</td>
              <td>{r.actor}</td>
              <td>{r.type}</td>
              <td className="font-mono">{r.headerId}</td>
              <td>{r.destinationId} {r.destinationName ?? ""}</td>
              <td>{r.vendorId}</td>
              <td>{r.deliveryDate}</td>
              <td className="truncate">{r.memo ?? ""}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={8} className="text-center text-slate-500 py-6">該当なし</td></tr>
          )}
        </tbody>
      </table>
      {/* 詳細ビュー（モーダル） */}
      {detailOpen && selected && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-[min(900px,92vw)] max-h-[86vh] overflow-hidden border">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="font-semibold">監査詳細</div>
              <div className="flex gap-2">
                <button
                  className="border rounded px-3 py-1"
                  onClick={() => {
                    const text = JSON.stringify(selected, null, 2);
                    navigator.clipboard?.writeText(text).catch(()=>{});
                  }}
                  title="JSONをクリップボードにコピー"
                >
                  コピー
                </button>
                <button className="border rounded px-3 py-1" onClick={() => setDetailOpen(false)}>閉じる</button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
              {/* サマリ（左） */}
              <div className="p-4 border-r md:block">
                <div className="text-sm grid grid-cols-[8rem,1fr] gap-x-3 gap-y-2">
                  <div className="text-slate-500">日時</div><div>{selected.at.replace("T"," ").replace("Z","")}</div>
                  <div className="text-slate-500">ユーザー</div><div>{selected.actor}</div>
                  <div className="text-slate-500">種別</div><div>{selected.type}</div>
                  <div className="text-slate-500">伝票番号</div><div className="font-mono">{selected.headerId ?? ""}</div>
                  <div className="text-slate-500">納品先</div><div>{selected.destinationId ?? ""} {selected.destinationName ?? ""}</div>
                  <div className="text-slate-500">ベンダー</div><div>{selected.vendorId ?? ""}</div>
                  <div className="text-slate-500">納品日</div><div>{selected.deliveryDate ?? ""}</div>
                  <div className="text-slate-500">所有主体</div><div>{selected.ownerId ?? ""}</div>
                </div>
                {selected.memo && (
                  <div className="mt-3">
                    <div className="text-slate-500 text-sm mb-1">メモ</div>
                    <div className="border rounded p-2 text-sm bg-slate-50">{selected.memo}</div>
                  </div>
                )}
              </div>
              {/* JSON（右） */}
              <div className="p-4 overflow-auto">
                <div className="text-slate-500 text-sm mb-1">Raw JSON</div>
                <pre className="text-xs bg-slate-50 border rounded p-3 overflow-auto">
      {JSON.stringify(selected, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>   
  );
}
