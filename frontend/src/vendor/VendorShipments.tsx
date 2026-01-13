import React, { useEffect, useMemo, useState } from "react";
import type { VendorOrderHeader, VendorOrderLine } from "./apiVendor";
import { downloadCsv } from "../utils/csv";
import { ensureFromShipments } from "../inspection/inspectionApi";
import { logEvent } from "../auditlog";
import type { MasterVendor } from "./apiVendor";
import { searchShipments, seedDemoIfEmpty, confirmShipments, unconfirmShipments, listVendors, generateShipments } from "./apiVendor";
import { ymd, formatYMD } from "../utils/date"
import {
   buildPickingCsv,
   openDeliveryNotePrint,
   openInvoicePrint,
   openPickingPrintWithStores,
 } from "../reports";

// ID 正規化（ゼロ埋め固定長）
const ID = {
  vendor: (s: string) => String(s ?? "").replace(/\D/g, "").padStart(6, "0"),
  item:   (s: string) => String(s ?? "").replace(/\D/g, "").padStart(6, "0"),
  store:  (s: string) => String(s ?? "").replace(/\D/g, "").padStart(4, "0"),
};


function formatDateTimeLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${dd} ${hh}:${mi}:${ss}`;
}

export function VendorShipments({ onEdit }: { onEdit?: (id: string, vendorId?: string) => void }) {
  const [dateFrom, setDateFrom] = useState<string>(ymd(new Date()));
  const [dateTo, setDateTo] = useState<string>(ymd(new Date()));
  const [searchHeaderId, setSearchHeaderId] = useState<string>("");
  const [vendorId, setVendorId] = useState<string>(() => sessionStorage.getItem("shipments.vendorId") || "");
  const [destinationId, setDestinationId] = useState<string>("");
  const [includeHeader, setIncludeHeader] = useState<boolean>(true);
  const [delimiter, setDelimiter] = useState<"," | "\t">(",");
  const [headers, setHeaders] = useState<VendorOrderHeader[]>([]);
  const [lines, setLines] = useState<VendorOrderLine[]>([]);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // ベンダーモーダル（未定義エラーの解消）
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
const [vendorModalOpen, setVendorModalOpen] = useState(false);
const [vendors, setVendors] = useState<MasterVendor[]>([]);
const [vendorFilter, setVendorFilter] = useState("");
const [previewSummary, setPreviewSummary] = useState<string>("");
const [generateSummary, setGenerateSummary] = useState<string>("");


// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => { seedDemoIfEmpty(); initFromQueryAndSearch(); }, []);

useEffect(() => { if (vendorModalOpen && vendors.length === 0) { (async () => setVendors(await listVendors()))(); } }, [vendorModalOpen]);

async function doSearch() {
  const df = dateFrom || "";
  const dt = dateTo || "";
  const vid = vendorId ? ID.vendor(vendorId) : "";
  const did = destinationId ? ID.store(destinationId) : "";
  const hid = (searchHeaderId || "").trim();

  // ★検索条件を保存（戻り遷移で使う）
  sessionStorage.setItem("shipments.dateFrom", df);
  sessionStorage.setItem("shipments.dateTo", dt);
  sessionStorage.setItem("shipments.vendorId", vid);
  sessionStorage.setItem("shipments.destinationId", did);
  sessionStorage.setItem("shipments.headerId", hid);
  sessionStorage.setItem("shipments.lastSearch", "1");

  // ★URL も同条件にしておく（リロード/戻りで復元できる）
  const q = new URLSearchParams();
  if (df) q.set("dateFrom", df);
  if (dt) q.set("dateTo", dt);
  if (vid) q.set("vendorId", vid);
  if (did) q.set("destinationId", did);
  if (hid) q.set("headerId", hid);

  const base = location.hash.split("?")[0] || "#/vendor/shipments";
  const qs = q.toString();
  history.replaceState(null, "", qs ? `${base}?${qs}` : base);

  await doSearchWith({
    dateFrom: df,
    dateTo: dt,
    vendorId: vid || undefined,
    destinationId: did || undefined,
    headerId: hid || undefined,
  });
}

useEffect(() => {
  if (!vendorModalOpen || vendors.length > 0) return;
  (async () => { setVendors(await listVendors()); })();
}, [vendorModalOpen, vendors.length]);

async function doSearchWith(params: { dateFrom?: string; dateTo?: string; vendorId?: string; destinationId?: string; headerId?: string; }) {
   const res = await searchShipments({
      ...params,
      vendorId: params.vendorId ? ID.vendor(params.vendorId) : undefined,
      destinationId: params.destinationId ? ID.store(params.destinationId) : undefined,
    });
  setHeaders(res.headers);
  setLines(res.lines);

  // 選択初期化
  const initSel: Record<string, boolean> = {};
  for (const h of res.headers) initSel[h.id] = false;
  setSelected(initSel);

  // selectId で自動選択＆ハイライト
  const q = new URLSearchParams((location.hash.split("?")[1] || ""));
  const sel = q.get("selectId");
  if (sel && res.headers.some(h => h.id === sel)) {
    setSelected(prev => ({ ...prev, [sel]: true }));
    setHighlightId(sel);
    requestAnimationFrame(() => {
      document.querySelector(`[data-header-id="${sel}"]`)?.scrollIntoView({ block: "center" });
    });
    setTimeout(() => setHighlightId(null), 2500);

    // selectId だけ除去（検索条件は維持）
    const base = location.hash.split("?")[0];
    const kept = new URLSearchParams(q);
    kept.delete("selectId");
    history.replaceState(null, "", `${base}?${kept.toString()}`);
  }
}

  useEffect(() => { seedDemoIfEmpty();
    initFromQueryAndSearch();
   }, []);

   const totals = useMemo<{ cnt: number; qty: number }>(() => {
    const cnt = headers.length;
    const qty = lines.reduce((s: number, l: VendorOrderLine) => s + Number(l.shipQty || 0), 0);
    return { cnt, qty };
  }, [headers, lines]);
  
  function toggleOne(id: string, checked: boolean): void {
    setSelected(prev => ({ ...prev, [id]: checked }));
  }

  function handleCsv(): void {
    const csv = buildPickingCsv(headers, lines, { includeHeader, delimiter });
    const ext: "csv" | "tsv" = delimiter === "\t" ? "tsv" : "csv";
    // 期間指定検索の代表日として dateFrom を採用
    const baseDate = dateFrom === dateTo ? dateFrom : `${dateFrom}_${dateTo}`;
    downloadCsv(`picking_${vendorId}_${baseDate}.${ext}`, csv);
  }



    async function handleConfirm(): Promise<void> {
    // open のみを対象にする
    const targets = headers.filter(
      (h) => selected[h.id] && h.status === "open"
    );
    const ids = targets.map((h) => h.id);

    // --- ログ: 選択状況 ---
    console.log("[VendorShipments.handleConfirm] selected(open only) headers:", targets);
    console.log("[VendorShipments.handleConfirm] ids to confirm:", ids);

    if (ids.length === 0) {
      alert("確定対象（open）が選択されていません。");
      return;
    }
    if (!confirm(`${ids.length}件の伝票を確定します。よろしいですか？`)) return;

    try {
      console.log("[VendorShipments.handleConfirm] call confirmShipments(ids)...");
      await confirmShipments(ids);
      console.log("[VendorShipments.handleConfirm] confirmShipments done.", { ids });

      // ★ 1件ずつ記録
      for (const h of targets) {
        logEvent({
          type: "shipment.confirm",
          headerId: h.id,
          vendorId: h.vendorId,
          destinationId: h.destinationId,
          destinationName: h.destinationName,
          deliveryDate: h.deliveryDate,
          memo: "一括確定",
        });
      }

      // --- ログ: ensureFromShipments に渡す情報を確認 ---
      console.log("[VendorShipments.handleConfirm] ensureFromShipments args summary:", {
        ids,
        headerCount: headers.length,
        lineCount: lines.length,
        targetCount: targets.length,
        // destinationId と id の対応を確認したいので簡易サマリを出す
        headerDestinations: headers.map((h) => ({
          id: h.id,
          destinationId: h.destinationId,
        })),
      });

      // 検品データの自動生成（出荷 → inspections）
      console.log("[VendorShipments.handleConfirm] call ensureFromShipments(headers, lines, ids)...");
      await ensureFromShipments(headers, lines, ids);
      console.log("[VendorShipments.handleConfirm] ensureFromShipments finished.");

      // 再検索
      await doSearch();
      console.log("[VendorShipments.handleConfirm] doSearch() finished. all done.");
    } catch (e) {
      console.error("[VendorShipments.handleConfirm] error during confirm/ensure:", e);
      alert(
        "出荷の確定または検品データの生成でエラーが発生しました。\n" +
          "詳細はブラウザのコンソールログを確認してください。"
      );
    }
  }


  async function handleUnconfirm(): Promise<void> {
    const targets = headers.filter(h => selected[h.id] && h.status === "confirmed");
    const ids = targets.map(h => h.id);
    if (ids.length === 0) { alert("取消対象（confirmed）が選択されていません。"); return; }
    if (!confirm(`${ids.length}件の確定を取り消します。よろしいですか？`)) return;

    await unconfirmShipments(ids);
    // 取消成功後
    for (const h of targets) {
      logEvent({
        type: "shipment.unconfirm",
        headerId: h.id,
        vendorId: h.vendorId,
        destinationId: h.destinationId,
        destinationName: h.destinationName,
        deliveryDate: h.deliveryDate,
        memo: "確定取消",
      });
    }

    await doSearch();
  }

  async function initFromQueryAndSearch(): Promise<void> {
    const q = new URLSearchParams((location.hash.split("?")[1] || ""));

    const lastSearch = sessionStorage.getItem("shipments.lastSearch") === "1";
    const hasQuery = Array.from(q.keys()).length > 0 || lastSearch;

    // クエリ優先 → 無ければ sessionStorage
    let df = q.get("dateFrom") || q.get("deliveryDate") || sessionStorage.getItem("shipments.dateFrom") || "";
    let dt = q.get("dateTo")   || q.get("deliveryDate") || sessionStorage.getItem("shipments.dateTo")   || "";
    const vidRaw = q.get("vendorId") || sessionStorage.getItem("shipments.vendorId") || vendorId || "";
    const didRaw = q.get("destinationId") || sessionStorage.getItem("shipments.destinationId") || destinationId || "";
    const hid = q.get("headerId") || sessionStorage.getItem("shipments.headerId") || "";

    if (!df && !dt) {
      const today = formatYMD(new Date());
      df = today; dt = today;
    } else {
      if (!df) df = dt;
      if (!dt) dt = df;
    }

    const vid6 = vidRaw ? ID.vendor(vidRaw) : "";
    const did4 = didRaw ? ID.store(didRaw) : "";

    if (df   !== dateFrom)       setDateFrom(df);
    if (dt   !== dateTo)         setDateTo(dt);
    if (vid6 !== vendorId)       setVendorId(vid6);
    if (did4 !== destinationId)  setDestinationId(did4);
    if (hid  !== searchHeaderId) setSearchHeaderId(hid);

    if (!hasQuery) {
      setHeaders([]); setLines([]); setSelected({}); setHighlightId(null);
      return;
    }

    await doSearchWith({ dateFrom: df, dateTo: dt, vendorId: vid6, destinationId: did4, headerId: hid });
  }

  return (
    <div className="p-4 space-y-3">
      <h1 className="text-xl font-bold">ベンダー出荷 - 受注一覧</h1>
      <div className="flex flex-wrap items-end gap-3">
        <label>発注日(自)
          <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className="border rounded px-2 py-1" />
        </label>
        <label>発注日(至)
          <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} className="border rounded px-2 py-1" />
        </label>
        <label>ベンダー
          <input
            value={vendorId}
            onChange={e=>{
              const raw = e.target.value;
              setVendorId(raw);
              // セーフティ：常に直近の入力を保存（正規化しておく）
              const padded = raw ? ID.vendor(raw) : "";
              sessionStorage.setItem("shipments.vendorId", padded);
            }}
            className="border rounded px-2 py-1 w-28"
          />
        </label>
        <button
          type="button"
          className="border rounded px-2 py-1"
          onClick={() => setVendorModalOpen(true)}
        >
          選択
        </button>
        <label>納品先ID
          <input value={destinationId} onChange={e=>setDestinationId(e.target.value)} className="border rounded px-2 py-1 w-28" />
        </label>
        <label>伝票番号
          <input value={searchHeaderId} onChange={e=>setSearchHeaderId(e.target.value)} className="border rounded px-2 py-1 w-44" placeholder="VOH-..." />
        </label>
        <button className="border rounded px-3 py-1" onClick={doSearch}>検索</button>
        <button
          type="button"
          className="border rounded px-3 py-1"
          onClick={() => {
            const today = formatYMD(new Date());
            setDateFrom(today);
            setDateTo(today);
            setVendorId("");
            sessionStorage.setItem("shipments.vendorId", ""); // 直近値も消す
            setDestinationId("");
            setSearchHeaderId("");

            // ★ リストもクリア
            setHeaders([]);
            setLines([]);
            setSelected({});
            setHighlightId(null);
                // ★ 件数メッセージもクリア
            setPreviewSummary("");
            setGenerateSummary("");
          }}
          title="条件を本日単日にリセット"
        >
          検索条件リセット
        </button>
        <button
          type="button"
          className="border rounded px-3 py-1"
          onClick={async () => {
            const now = new Date();

            const payload = {
              asOf: formatDateTimeLocal(now),
              from: dateFrom || undefined,       // 発注日 from
              to: dateTo || undefined,           // 発注日 to
              vendorId: vendorId ? ID.vendor(vendorId) : undefined,
              destinationId: destinationId ? ID.store(destinationId) : undefined,
              dryRun: false,
            };

            try {
              const r = await generateShipments(payload);

              if (!r || r.ok === false) {
                setGenerateSummary(`出荷生成失敗: ${r?.error ?? "internal_error"}`);
                return;
              }

              const headersAffected = r.headersAffected ?? r.countHeaders ?? 0;
              const linesAffected = r.linesAffected ?? r.countLines ?? 0;
              const createdHeaders = r.createdHeaders ?? 0;
              const skippedHeaders = r.skippedHeaders ?? 0;
              const skippedLines = r.skippedLines ?? 0;

              let msg =
                `対象ヘッダ ${headersAffected} 件 / 明細 ${linesAffected} 行` +
                `（新規ヘッダ ${createdHeaders} 件）`;
              if (skippedHeaders || skippedLines) {
                msg += `／確定済みヘッダ ${skippedHeaders} 件 / 明細 ${skippedLines} 行はスキップ`;
              }

              setGenerateSummary(msg);

              // ★ ここで一覧を最新状態にリロード
              await doSearch();
            } catch (e: unknown) {
              console.error("generateShipments failed", e);
              setGenerateSummary("出荷生成失敗: 通信エラー");
            }
          }}
          title="締切を過ぎた受注だけを、納品日 = 受注日 + LT で出荷に生成"
        >
          締切越え→出荷生成
        </button>
        <button
          type="button"
          className="border rounded px-3 py-1"
          onClick={async () => {
            const now = new Date();

            const payload = {
              asOf: formatDateTimeLocal(now),
              from: dateFrom || undefined,       // 発注日 from
              to: dateTo || undefined,           // 発注日 to
              vendorId: vendorId ? ID.vendor(vendorId) : undefined,
              destinationId: destinationId ? ID.store(destinationId) : undefined,
              dryRun: true,
            };

            try {
              const r = await generateShipments(payload);

              if (!r || r.ok === false) {
                setPreviewSummary(`プレビュー失敗: ${r?.error ?? "internal_error"}`);
                return;
              }

              const countHeaders = r.countHeaders ?? r.headersAffected ?? 0;
              const countLines = r.countLines ?? r.linesAffected ?? 0;
              const skippedHeaders = r.skippedHeaders ?? 0;
              const skippedLines = r.skippedLines ?? 0;
              const reasons = r.reasons;

              let msg = `対象ヘッダ ${countHeaders} 件 / 明細 ${countLines} 行`;

              if (countHeaders === 0 && countLines === 0) {
                msg = "発注なし";

                const hints: string[] = [];
                if ((reasons?.totalBaseLines ?? 0) === 0) {
                  hints.push("対象期間に受注がありません");
                } else {
                  if ((reasons?.excludedNotOrderable ?? 0) > 0) {
                    hints.push(`発注不可曜日（override含む）: ${reasons?.excludedNotOrderable} 行`);
                  }
                  if ((reasons?.excludedBeforeCutoff ?? 0) > 0) {
                    hints.push(`締め前: ${reasons?.excludedBeforeCutoff} 行`);
                  }
                  if ((reasons?.missingUnitPrice ?? 0) > 0) {
                    hints.push(`単価未設定: ${reasons?.missingUnitPrice} 行`);
                  }
                  if ((reasons?.missingCutoffHHmm ?? 0) > 0) {
                    hints.push(`締め時刻未設定: ${reasons?.missingCutoffHHmm} 行`);
                  }
                }

                if (hints.length) msg += `（${hints.join(" / ")}）`;
              } else {
                // 従来のスキップ表示（未使用warning回避）
                if (skippedHeaders || skippedLines) {
                  msg += `（確定済みヘッダ ${skippedHeaders} 件 / 明細 ${skippedLines} 行は除外）`;
                }
              }

              setPreviewSummary(msg);
            } catch (e: unknown) {
              console.error("generateShipments preview failed", e);
              setPreviewSummary("プレビュー失敗: 通信エラー");
            }
          }}
          title="実際には作成せず、生成対象件数だけ確認"
        >
          生成プレビュー
        </button> 
        {/* プレビュー・生成結果の表示 */}
        {(previewSummary || generateSummary) && (
          <div style={{ marginTop: 8, fontSize: "0.85rem", lineHeight: 1.5 }}>
            {previewSummary && (
              <div>【プレビュー】{previewSummary}</div>
            )}
            {generateSummary && (
              <div>【出荷生成】{generateSummary}</div>
            )}
          </div>
        )}     
      </div>      
      <div className="flex items-center gap-4">
        <span>件数: <b>{totals.cnt}</b></span>
        <span>合計出荷数量: <b>{totals.qty}</b></span>

        <label className="ml-auto flex items-center gap-2">
          <input type="checkbox" checked={includeHeader} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIncludeHeader(e.target.checked)} /> ヘッダー
        </label>
        <label className="flex items-center gap-2">区切り
          <select
            value={delimiter}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDelimiter(e.target.value as "," | "\t")}
            className="border rounded px-2 py-1 w-24"
          >
            <option value=",">カンマ</option>
            <option value={"	"}>タブ</option>
          </select>
        </label>
        <button
          className="border rounded px-3 py-1"
          onClick={() => {
            const ids = Object.entries(selected).filter(([,v]) => v).map(([k]) => k);
            if (ids.length === 0) { alert("対象の伝票を選択してください。"); return; }
            const groups = headers
              .filter(h => ids.includes(h.id))
              .map(h => ({ header: h, lines: lines.filter(l => l.headerId === h.id) }));
            openPickingPrintWithStores(groups);
          }}
        >
         ピッキングPDF（品目×店舗）
        </button>
        <button className="border rounded px-3 py-1" onClick={handleCsv} disabled={headers.length===0}>ピッキングCSV</button>
        <button
          className="border rounded px-3 py-1"
          onClick={() => {
            const ids = Object.entries(selected).filter(([,v]) => v).map(([k]) => k);
            if (ids.length === 0) { alert("対象の伝票を選択してください。"); return; }
            const groups = headers
              .filter(h => ids.includes(h.id))
              .map(h => ({
                header: h,
                lines: lines.filter(l => l.headerId === h.id)
              }));
            openInvoicePrint(groups);
          }}
        >
          納品書PDF（店舗ごと）
        </button>
        <button
          className="border rounded px-3 py-1"
          onClick={handleConfirm}
          disabled={headers.every(h => !(selected[h.id] && h.status === "open"))}
        >
          選択を出荷確定
        </button>
        <button
          className="border rounded px-3 py-1"
          onClick={handleUnconfirm}
          disabled={headers.every(h => !(selected[h.id] && h.status === "confirmed"))}
        >
          選択を確定取消
        </button>

        {/* 新規伝票ボタン */}
         <button
          className="border rounded px-3 py-1"
          onClick={() => {
            const vid = vendorId ? ID.vendor(vendorId) : "";
            // 念のためここでも保存（ボタン直前の値を確実に残す）
            sessionStorage.setItem("shipments.vendorId", vid);
            // 編集パスへハッシュ遷移（VendorEdit が vendorId を確実に取得）
            location.hash = `#/vendor/shipments/edit?id=new${vid ? `&vendorId=${encodeURIComponent(vid)}` : ""}`;
            // 念のため親状態も切替（どちら経路でも到達できる二重化）
            // onEdit("new");
            // ここで “明示的に” ベンダーIDも渡す（App が即時に受け取って引継）
            // onEdit("new", vid || undefined);
            onEdit?.("new", vid || undefined);
          }}
        >
          新規伝票
        </button>
      </div>
      <div style={{ overflow: "auto", maxHeight: "60vh" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ borderBottom: "1px solid #e2e8f0", padding: "6px 8px" }}>
                <input
                  type="checkbox"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const checked = e.target.checked;
                    const next: Record<string, boolean> = {};
                    for (const h of headers) next[h.id] = checked;
                    setSelected(next);
                  }}
                  checked={headers.length>0 && headers.every(h => selected[h.id])}
                  aria-label="すべて選択"
                />
              </th>
              <th style={{ borderBottom: "1px solid #e2e8f0", padding: "6px 8px" }}>伝票番号</th>
              <th style={{ borderBottom: "1px solid #e2e8f0", padding: "6px 8px" }}>発注日</th>
              <th style={{ borderBottom: "1px solid #e2e8f0", padding: "6px 8px" }}>納品日</th>
              <th style={{ borderBottom: "1px solid #e2e8f0", padding: "6px 8px" }}>ベンダー</th>
              <th style={{ borderBottom: "1px solid #e2e8f0", padding: "6px 8px" }}>納品先</th>
              <th style={{ borderBottom: "1px solid #e2e8f0", padding: "6px 8px" }}>状態</th>
              <th style={{ borderBottom: "1px solid #e2e8f0", padding: "6px 8px" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {headers.map((h: VendorOrderHeader) => {
              const isConfirmed = h.status === "confirmed"; // ← 使う
              return (
                <tr
                  key={h.id}
                  data-header-id={h.id}
                  onDoubleClick={() => { location.hash = `#/vendor/shipments/edit?id=${h.id}`; }}
                  className={`${isConfirmed ? "opacity-60" : ""} ${highlightId === h.id ? "bg-yellow-50" : ""} cursor-pointer hover:bg-slate-50`}
                >
                  <td style={{ padding: "6px 8px", textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={!!selected[h.id]}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => toggleOne(h.id, e.target.checked)}
                      aria-label={`選択: ${h.id}`}
                    />
                  </td>
                  <td style={{ padding: "6px 8px" }}>{h.id}</td>
                  <td style={{ padding: "6px 8px" }}>{h.orderDate}</td>
                  <td style={{ padding: "6px 8px" }}>{h.deliveryDate}</td>
                  <td style={{ padding: "6px 8px" }}>{h.vendorName || h.vendorId}</td>
                  <td style={{ padding: "6px 8px" }}>{h.destinationName || h.destinationId}</td>
                  <td style={{ padding: "6px 8px" }}>{h.status}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <button
                     className="border rounded px-2 py-1"
                     onClick={() => { location.hash = `#/vendor/shipments/edit?id=${h.id}`; }}
                     disabled={isConfirmed}  // ★ 確定済みは編集不可
                     title={isConfirmed ? "確定済みの伝票は編集できません" : "編集"}
                    >
                      編集
                    </button>
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <button
                      className="border rounded px-2 py-1"
                      onClick={() => {
                        const hdr = headers.find(x => x.id === h.id)!;
                        const ls = lines.filter(x => x.headerId === h.id);
                        openDeliveryNotePrint(hdr, ls);
                      }}
                    >
                      納品書
                    </button>
                  </td>
                </tr>
              );
            })}
            {headers.length === 0 && (
              <tr><td colSpan={6} style={{ color:"#64748b", padding:"8px" }}>データがありません。条件を指定して「検索」を押してください。</td></tr>
            )}           
          </tbody>
        </table>
      </div>
      {vendorModalOpen && (
        <div
          className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
          onClick={() => setVendorModalOpen(false)}
        >
          <div
            className="bg-white rounded-xl p-3 w-[520px] max-h-[70vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-2">
              <b>ベンダーを選択</b>
              <input
                className="border rounded px-2 py-1 ml-auto"
                placeholder="ID/名称で絞り込み"
                value={vendorFilter}
                onChange={(e) => setVendorFilter(e.target.value)}
              />
            </div>

            <table className="w-full text-sm">
              <tbody>
                {vendors
                  .filter(v => (v.id + (v.name || "")).includes(vendorFilter))
                  .map(v => (
                    <tr
                      key={v.id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => {
                        const vid = v.id;
                        setVendorId(vid);
                        sessionStorage.setItem("shipments.vendorId", vid); // 一覧の既定ベンダーとして保持
                        setVendorModalOpen(false);
                      }}
                    >
                      <td className="border-b px-2 py-1 font-mono">{v.id}</td>
                      <td className="border-b px-2 py-1">{v.name}</td>
                    </tr>
                  ))}
              </tbody>
            </table>

            <div className="text-right mt-2">
              <button className="border rounded px-3 py-1" onClick={() => setVendorModalOpen(false)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

