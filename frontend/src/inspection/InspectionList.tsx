import { useEffect, useMemo, useState } from "react";
import { searchInspections, confirmInspections, auditInspections  } from "./inspectionApi";
import type { OwnerType, InspectionHeader, InspectionLine } from "./inspectionApi";
import { buildDiscrepancyCsv } from "./discrepancyCsv";
import { downloadCsv } from "../utils/csv";
import { logEvent } from "../auditlog";
import { VendorModal } from "../components/VendorModal";
import { ymd } from "../utils/date";
import {
  INSPECTION_LIST_STATUS_FILTER_OPTIONS,
  type InspectionListStatusFilter,
} from "../domain/codes";

export type Props = {
  ownerType: OwnerType;   // "STORE" | "DC"
  ownerId: string;        // 例: "0001" / "DC01"
  onEdit: (inspectionId: string) => void;
  onBack?: () => void;
};

export function InspectionList({ ownerType, ownerId, onEdit, onBack }: Props) {
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [vendorId, setVendorId] = useState<string>("");

  const [headers, setHeaders] = useState<InspectionHeader[]>([]);
  const [lines, setLines] = useState<InspectionLine[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  // 状態フィルタ: all / open / confirmed
  const [statusFilter, setStatusFilter] = useState<InspectionListStatusFilter>("all");
  // 差異ありのみ表示
  const [showOnlyDiff, setShowOnlyDiff] = useState<boolean>(false);



   // 検品ヘッダごとの「差異ありフラグ」を計算
  const headerHasDiff = useMemo<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const l of lines) {
      const diff = Number(l.diffQty ?? 0);
      if (!diff) continue;
      const inspectionId = String(l.inspectionId);
      map[inspectionId] = true;
    }
    return map;
  }, [lines]);

  // 状態フィルタ / 差異のみフィルタを適用したヘッダ
  const filteredHeaders = useMemo(() => {
    return headers.filter((h) => {
      const st = (h.status ?? "").toLowerCase().trim();
      const isOpen = st === "open";
      const isConfirmed = !isOpen; // open 以外は「検収済み」と扱う

      // 状態フィルタ
      if (statusFilter === "open" && !isOpen) return false;
      if (statusFilter === "confirmed" && !isConfirmed) return false;

      // 差異ありのみ
      if (showOnlyDiff && !headerHasDiff[String(h.id)]) return false;

      return true;
    });
  }, [headers, statusFilter, showOnlyDiff, headerHasDiff]);


  // 初期表示時：「今日-3日 ～ 今日」をデフォルトにして自動検索
  useEffect(() => {
    const today = new Date();
    const to0 = ymd(today);
    const fromDate = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000);
    const from0 = ymd(fromDate);

    setFrom(from0);
    setTo(to0);

    // state 反映を待たず、計算した値で即検索
    (async () => {
      await doSearch({ from: from0, to: to0 });
    })();
    // ownerType / ownerId が変わるケースは少ない想定なので依存に含める
  }, [ownerType, ownerId]);

  async function doSearch(initial?: {
    from?: string;
    to?: string;
    vendorId?: string;
  }): Promise<void> {
    const normalize = (s: string, width: number) => {
      const digits = String(s || "").replace(/\D/g, "");
      return digits ? digits.padStart(width, "0") : "";
    };

    const fromVal = initial?.from ?? from;
    const toVal = initial?.to ?? to;

    // ★ 日付バリデーション（from > to の場合は検索しない）
    if (fromVal && toVal && fromVal > toVal) {
      alert("開始日が終了日より後になっています。日付を確認してください。");
      return;
    }

    // vendorId は引数があればそちらを優先
    const vendorRaw =
      initial && "vendorId" in initial
        ? initial.vendorId ?? ""
        : vendorId;

    const vId = vendorRaw ? normalize(vendorRaw, 6) : "";

    const res = await searchInspections({
      from: fromVal || undefined,
      to: toVal || undefined,
      vendorId: vId || undefined,
      ownerType,
      ownerId,
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
        inspectionId: String(h.id),
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

  // ★ DC向け：監査（completed → audited）
async function handleAudit(): Promise<void> {
  // 監査対象は completed のものだけ
  const targets = headers.filter(
    (h) => selected[h.id] && h.status === "completed"
  );
  const ids = targets.map((h) => h.id);

  if (ids.length === 0) {
    alert("監査対象（completed）が選択されていません。");
    return;
  }
  if (!confirm(`${ids.length}件を監査済みにします。よろしいですか？`)) return;

  await auditInspections(ids);

  // ★ 各伝票ごとに監査ログを記録
  for (const h of targets) {
    logEvent({
      type: "inspection.audit",
      inspectionId: String(h.id),
      ownerId: ownerId,            // DC側一覧の ownerId（例: DC01）
      vendorId: h.vendorId,
      destinationId: h.destinationId,
      destinationName: h.destinationName,
      deliveryDate: h.deliveryDate,
      memo: "検品監査完了",
    });
  }

  await doSearch();
}

  const totals = useMemo<{
    cnt: number;
    ship: number;
    insp: number;
    diffCount: number;
  }>(() => {
    const cnt = filteredHeaders.length;

    const filteredIdSet = new Set(filteredHeaders.map((h) => h.id));

    const bySel = new Set(
      filteredHeaders.filter((h) => selected[h.id]).map((h) => h.id)
    );

    const ship = lines
      .filter(
        (l) =>
          filteredIdSet.has(l.inspectionId) &&
          (bySel.size === 0 || bySel.has(l.inspectionId))
      )
      .reduce((s, l) => s + Number(l.shipQty ?? 0), 0);

    const insp = lines
      .filter(
        (l) =>
          filteredIdSet.has(l.inspectionId) &&
          (bySel.size === 0 || bySel.has(l.inspectionId))
      )
      .reduce((s, l) => s + Number(l.inspectedQty ?? 0), 0);

    // 差異ありヘッダ件数（フィルタ＋選択に応じて）
    const diffHeaderIds = new Set<number>();
    for (const l of lines) {
      const diff = Number(l.diffQty ?? 0);
      if (!diff) continue;
      if (!filteredIdSet.has(l.inspectionId)) continue;
      if (bySel.size > 0 && !bySel.has(l.inspectionId)) continue;
      diffHeaderIds.add(l.inspectionId);
    }

    return { cnt, ship, insp, diffCount: diffHeaderIds.size };
  }, [filteredHeaders, lines, selected]);


  return (
    <div className="p-4 space-y-3">
      <h1 className="text-xl font-bold">検品一覧（{ownerType}:{ownerId}）</h1>
      <div className="flex flex-wrap items-end gap-3">
        {onBack && <button className="border rounded px-3 py-1" onClick={onBack}>← 戻る</button>}
        <label className="flex flex-col gap-1">
          <span>納品日 From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border rounded px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span>納品日 To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border rounded px-2 py-1"
          />
        </label>
        <div className="flex items-center gap-2">
        <label>
          ベンダーID
          <input
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            className="border rounded px-2 py-1 w-28"
            placeholder="000001"
          />
        </label>

        <button
          className="border rounded px-2 py-1"
          onClick={() => setVendorModalOpen(true)}
        >
          選択…
        </button>
        <label>
          状態
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as InspectionListStatusFilter)}
            className="border rounded px-2 py-1 ml-1"
          >
            {INSPECTION_LIST_STATUS_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={showOnlyDiff}
            onChange={(e) => setShowOnlyDiff(e.target.checked)}
          />
          差異ありのみ
        </label>
      </div>
      <button className="border rounded px-3 py-1" onClick={() => doSearch()}>検索</button>
        <button
          className="border rounded px-3 py-1"
          onClick={() => {
            const today = new Date();
            const to0 = ymd(today);
            const fromDate = new Date(
              today.getTime() - 3 * 24 * 60 * 60 * 1000
            );
            const from0 = ymd(fromDate);

            setFrom(from0);
            setTo(to0);
            setVendorId("");
            setStatusFilter("all");
            setShowOnlyDiff(false);
            setSelected({});

            doSearch({ from: from0, to: to0, vendorId: "" });
          }}
        >
          条件クリア
        </button>
        <button
          className="border rounded px-3 py-1"
          onClick={() => {
            const selIds = headers
              .filter((h) => selected[h.id])
              .map((h) => String(h.id));

            const csv = buildDiscrepancyCsv(headers, lines, {
              headerIds: selIds.length ? selIds : undefined,
              includeHeader: true,
              delimiter: ",",
            });

            const ext = "csv";
            const stamp = new Date()
              .toISOString()
              .slice(0, 19)
              .replace(/[-:T]/g, "");
            downloadCsv(
              `discrepancy_${ownerType}_${ownerId}_${stamp}.${ext}`,
              csv
            );
          }}
          disabled={headers.length === 0}
        >
          差異CSV
        </button>

        {/* {ownerType === "DC" && (
          <>
            <button
              className="border rounded px-3 py-1"
              onClick={() => {
                const selIds = headers.filter(h => selected[h.id]).map(h => String(h.id));
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
                const selIds = headers.filter(h => selected[h.id]).map(h => String(h.id));
                const slips = buildSlipsFromInspections(headers, lines, { headerIds: selIds.length ? selIds : undefined });
                if (slips.length === 0) { alert("差異がないため、発行対象の伝票がありません。"); return; }
                openSlipsPrint(slips);
              }}
              disabled={headers.length===0}
            >
              伝票発行PDF
            </button>
          </>
        )} */}

        <div className="ml-auto flex items-center gap-4">
          <span>件数: <b>{totals.cnt}</b></span>
          <span>出荷数合計: <b>{totals.ship}</b></span>
          <span>検品数合計: <b>{totals.insp}</b></span>
          <span>差異あり: <b>{totals.diffCount}</b> 件</span>

          {ownerType === "STORE" && (
            <button
              className="border rounded px-3 py-1"
              onClick={handleConfirm}
              disabled={headers.every(
                (h) => !(selected[h.id] && h.status === "open")
              )}
            >
              選択を検収確定
            </button>
          )}  
          
          {ownerType === "DC" && (
            <button
              className="border rounded px-3 py-1"
              onClick={handleAudit}
              disabled={headers.every(
                (h) => !(selected[h.id] && h.status === "completed")
              )}
            >
              選択を監査済みに
            </button>
          )}
        </div>
      </div>

      <div style={{ overflow:"auto", maxHeight:"60vh" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>
                <input
                  type="checkbox"
                  onChange={(e) => {
                    const on = e.target.checked;
                    setSelected((prev) => {
                      const next: Record<string, boolean> = { ...prev };
                      for (const h of filteredHeaders) {
                        next[h.id] = on;
                      }
                      return next;
                    });
                  }}
                  checked={
                    filteredHeaders.length > 0 &&
                    filteredHeaders.every((h) => selected[h.id])
                  }
                />
              </th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>検品ID</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>納品日</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>ベンダー</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>納品先</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>状態</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredHeaders.map((h: InspectionHeader) => {
              const st = (h.status ?? "").toLowerCase().trim();
              const isOpen = st === "open";
              const isCompleted = !isOpen;
              const hasDiff = headerHasDiff[String(h.id)];

              const rowStyle: React.CSSProperties = {
                borderBottom: "1px solid #e2e8f0",
                opacity: isCompleted ? 0.65 : 1,
                backgroundColor: hasDiff ? "#fee2e2" : undefined,
              };

              return (
                <tr key={h.id} style={rowStyle}>
                  <td style={{ padding:"6px 8px", textAlign:"center" }}>
                    <input type="checkbox" checked={!!selected[h.id]} onChange={(e)=>toggleOne(String(h.id), e.target.checked)} />
                  </td>
                  <td style={{ padding:"6px 8px" }}>{h.id}</td>
                  <td style={{ padding:"6px 8px" }}>{h.deliveryDate}</td>
                  <td style={{ padding:"6px 8px" }}>{h.vendorId}</td>
                  <td style={{ padding:"6px 8px" }}>{h.destinationId} {h.destinationName || ""}</td>
                  <td style={{ padding:"6px 8px" }}>
                    {h.status}
                    {headerHasDiff[String(h.id)] ? "（差異あり）" : ""}
                  </td>
                  <td style={{ padding:"6px 8px" }}>
                    {ownerType === "STORE" && (
                      <button
                        className="border rounded px-2 py-1 text-sm"
                        onClick={() => onEdit(String(h.id))}
                      >
                        編集
                      </button>
                    )}
                  {/* <button
                    className="border rounded px-2 py-1"
                    onClick={() => onEdit(String(h.id))}
                    disabled={isCompleted}
                    title={isCompleted ? "検収済みは編集できません" : "編集"}
                  >
                    編集
                  </button> */}
                  </td>
                </tr>
              );
            })}
            {filteredHeaders.length === 0 && <tr><td colSpan={6} style={{ color:"#64748b", padding:"8px" }}>データがありません。</td></tr>}
          </tbody>
        </table>
      </div>
      <VendorModal
        open={vendorModalOpen}
        onClose={() => setVendorModalOpen(false)}
        onSelect={(id) => {
          setVendorId(id);
          setVendorModalOpen(false);
        }}
      />
    </div>
  );
}
