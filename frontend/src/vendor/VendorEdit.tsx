import { useEffect, useMemo, useState } from "react";
import type { VendorOrderLine, VendorOrderHeader, TempZone, MasterItem, MasterStore, MasterVendor } from "./apiVendor";
import { ymd } from "../utils/date"
import {
  getShipment,
  listStores,
  deleteLine,
  listVendorItems,
  createShipment,
  updateShipmentHeader,
  replaceLines,
  isApiHttpError,
  listVendors
} from "./apiVendor";

import { TEMP_ZONES, TEMP_ZONE_LABEL } from "../domain/codes";

// ID 正規化（ゼロ埋め固定長）
const ID = {
  vendor: (s: string) => String(s ?? "").replace(/\D/g, "").padStart(6, "0"),
  item:   (s: string) => String(s ?? "").replace(/\D/g, "").padStart(6, "0"),
  store:  (s: string) => String(s ?? "").replace(/\D/g, "").padStart(4, "0"),
};

type Props = {
  shipmentId: string;
  onBack: () => void;
  /** App 側で解決した初期 vendorId（任意） */
  initialVendorId?: string;
};


export function VendorEdit({ shipmentId, onBack, initialVendorId }: Props) {
  const [header, setHeader] = useState<VendorOrderHeader | null>(null);
  const [lines, setLines] = useState<VendorOrderLine[]>([]);
  const [headerDraft, setHeaderDraft] = useState<{ deliveryDate: string; vendorId: string; destinationId: string; destinationName: string }>({
    deliveryDate: "",
    vendorId: "",
    destinationId: "",
    destinationName: "",
  });
  const [vendorItems, setVendorItems] = useState<MasterItem[]>([]);
  const [stores, setStores] = useState<MasterStore[]>([]);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [storeModalOpen, setStoreModalOpen] = useState(false);
  const [itemFilter, setItemFilter] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [vendors, setVendors] = useState<MasterVendor[]>([]);
  const [vendorFilter, setVendorFilter] = useState('');
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);


  useEffect(() => {
  if (!vendorModalOpen) return;
  if (vendors.length > 0) return;
  (async () => { setVendors(await listVendors()); })();
}, [vendorModalOpen, vendors.length]);


  // ルータから来ない場合に備え、ハッシュからも拾う保険
  const headerIdFromHash = new URLSearchParams(location.hash.split("?")[1] || "").get("id") || "new";
  const headerIdUse = shipmentId && shipmentId !== "new" ? shipmentId : headerIdFromHash;

  // 管理者は true にすると vendorId も編集可
  const IS_MANAGER = false;
  // 伝票が確定済みなら編集不可（ダブル防御）
  const isLocked = header?.status === "confirmed";
  const isNew = headerIdUse === "new";

  // 新規は誰でもベンダー編集可／既存は管理者のみ
  const canEditVendor = isNew || IS_MANAGER;
  useEffect(() => {
    (async () => {
      if (isNew) {
        // === 新規作成モード ===
        const q = new URLSearchParams((location.hash.split("?")[1] || ""));
        // 1) ハッシュの vendorId
        let vendorInit = q.get("vendorId") ? ID.vendor(q.get("vendorId")!) : "";
        // 2) セーフティ：ハッシュに無ければ直前の一覧条件から復元
        if (!vendorInit) {
          const vFromSS = sessionStorage.getItem("shipments.vendorId") || "";
          vendorInit = vFromSS ? ID.vendor(vFromSS) : "";
        }
        // 3) それでも空なら props（App 側で解決済み）を使用
        if (!vendorInit && initialVendorId) {
          vendorInit = ID.vendor(initialVendorId);
        }
        setHeader(null);
        setHeaderDraft({
          deliveryDate: ymd(new Date()),
          vendorId: vendorInit,
          destinationId: "",
          destinationName: "",
        });
        setLines([]);
        return;
      }

      // === 既存伝票モード ===
      const s = await getShipment(headerIdUse);
      setHeader(s.header ?? null);
      setLines(s.lines ?? []);
      if (s.header) {
        setHeaderDraft({
          deliveryDate: s.header.deliveryDate,
          vendorId: s.header.vendorId,
          destinationId: s.header.destinationId,
          destinationName: s.header.destinationName ?? "",
        });
      }
    })();
  }, [headerIdUse, isNew]);

  useEffect(() => {
    const vid = (header?.vendorId || headerDraft.vendorId || '').trim();
    if (!vid) { setVendorItems([]); return; }
    (async () => {
      setVendorItems(await listVendorItems(vid));
    })();
  }, [header?.vendorId, headerDraft.vendorId]);
  
  useEffect(() => {
    (async () => {
      if (storeModalOpen && stores.length === 0) {
        setStores(await listStores());
      }
    })();
  }, [storeModalOpen]);

  useEffect(() => {
  if (!vendorModalOpen) return;
  (async () => { if (vendors.length === 0) setVendors(await listVendors()); })();
}, [vendorModalOpen]);

  function setQty(i: number, v: number): void {
    setLines((prev: VendorOrderLine[]) =>
      prev.map((l: VendorOrderLine, idx: number) => (idx === i ? { ...l, shipQty: v } : l))
    );
  }

  const subtotal = useMemo<number>(
    () => lines.reduce((s: number, l: VendorOrderLine) => s + Number(l.shipQty || 0), 0),
    [lines]
  );

  const itemsForPick: MasterItem[] = vendorItems;
  const buildLinesForSave = (): VendorOrderLine[] => {
    const hid = isNew ? "new" : headerIdUse;

    return lines
      .map((l) => ({
        ...l,
        shipmentId: hid,
        itemId: ID.item(l.itemId || ""),
        itemName: l.itemName ?? "",
        unit: l.unit ?? "",
        spec: l.spec ?? "",
        tempZone: l.tempZone ?? undefined,
        note: l.note ?? "",
        lotNo: l.lotNo ?? "",
        orderedQty: Number(l.orderedQty || 0),
        shipQty: Number(l.shipQty || 0),
      }))
      .filter((l) => l.itemId !== "000000"); // 空入力などを弾く（必要なら条件調整）
  };

  function buildBackToListHash(selectId?: string) {
    const df  = sessionStorage.getItem("shipments.dateFrom") || "";
    const dt  = sessionStorage.getItem("shipments.dateTo") || "";
    const vid = sessionStorage.getItem("shipments.vendorId") || "";
    const did = sessionStorage.getItem("shipments.destinationId") || "";
    const hid = sessionStorage.getItem("shipments.shipmentId") || "";

    const q = new URLSearchParams();
    if (df) q.set("dateFrom", df);
    if (dt) q.set("dateTo", dt);
    if (vid) q.set("vendorId", vid);
    if (did) q.set("destinationId", did);
    if (hid) q.set("shipmentId", hid);
    if (selectId) q.set("selectId", selectId);

    const qs = q.toString();
    return qs ? `#/vendor/shipments?${qs}` : "#/vendor/shipments";
  }

  const onSave = async () => {
    if (saving) return;
    setSaving(true);

    try {
      // --- ヘッダ正規化 ---
      const deliveryDate = String(headerDraft.deliveryDate || "").slice(0, 10);
      const vendorId = ID.vendor(headerDraft.vendorId);
      const destinationId = ID.store(headerDraft.destinationId);
      const destinationName = String(headerDraft.destinationName || "");

      if (!deliveryDate || !vendorId || !destinationId) {
        alert("納品日 / ベンダー / 納品先ID は必須です。");
        return;
      }

      // 画面側にも正規化値を反映（ゼロ埋め）
      setHeaderDraft((d) => ({
        ...d,
        deliveryDate,
        vendorId,
        destinationId,
        destinationName,
      }));

      const saveLines = buildLinesForSave();

      // --- 保存 ---
      if (isNew) {
        // 新規作成（サーバ側が lines も受け取れる前提）
        const r = await createShipment({
          deliveryDate,
          // orderDate: deliveryDate, // サーバが必要なら。不要なら消してOK
          vendorId,
          destinationId,
          destinationName,
          lines: saveLines,
        });

        const newId = String(r?.header?.id || "");
        if (!newId) {
          alert("新規作成に失敗しました（id が返りません）。");
          return;
        }

        // 最新を再読込して画面に反映
        const s = await getShipment(newId);
        setHeader(s.header ?? null);
        setLines(s.lines ?? []);

        alert("保存しました。");
        onBack?.();
        location.hash = buildBackToListHash(newId);
        return;
      }

      // 既存更新
      const id = headerIdUse;

      await updateShipmentHeader(id, {
        deliveryDate,
        vendorId,
        destinationId,
        destinationName,
      });

      await replaceLines(id, saveLines);

      // 最新を再読込
      const s = await getShipment(id);
      setHeader(s.header ?? null);
      setLines(s.lines ?? []);

      alert("保存しました。");
      onBack?.();
      location.hash = buildBackToListHash(headerIdUse);
    } catch (e: unknown) {
      // 409 などを画面に出す
      if (isApiHttpError(e)) {
        const b =
          typeof e.body === "object" && e.body !== null
            ? (e.body as Record<string, unknown>)
            : null;

        const err = b?.error;
        const msg = b?.message;

        if (e.status === 409 && err === "unit_price_missing") {
          alert(typeof msg === "string" ? msg : "単価未登録の品目があるため保存できません。");
          return;
        }
        if (e.status === 409 && err === "shipment_duplicate") {
          alert(typeof msg === "string" ? msg : "同一条件の伝票が既に存在します。");
          return;
        }

        if (typeof msg === "string") {
          alert(msg);
          return;
        }

        alert(`${e.status} ${e.statusText}`);
        return;
      }

      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 space-y-3">
      <h1 className="text-xl font-bold">
        ベンダー出荷 - {isNew ? "新規" : "編集"}
      </h1>  
      <div className="flex justify-between items-center">
        <div className="text-sm text-slate-600">
          納品日: {(header?.deliveryDate ?? headerDraft.deliveryDate) || "-"} /
          ベンダー: {(header?.vendorId ?? headerDraft.vendorId) || "-"} /
          納品先: {(header?.destinationId ?? headerDraft.destinationId) || "-"} { (header?.destinationName ?? headerDraft.destinationName) || "" }
        </div>
        <button
          type="button"
          className="border rounded px-3 py-1"
          onClick={() => {
          onBack?.();
          location.hash = buildBackToListHash();
          }}
        >
          一覧へ戻る
        </button>
      </div>
        {/* === ヘッダ編集（確定済みは無効） === */}
        <div className="p-3 border rounded-lg bg-white">
          <div className="text-sm text-slate-600 mb-2">ヘッダ編集</div>
          <div className="flex flex-wrap items-end gap-3">
            <label>納品日
              <input
                type="date"
                value={headerDraft.deliveryDate}
                onChange={(e)=> setHeaderDraft(d => ({ ...d, deliveryDate: e.target.value }))}
                className="border rounded px-2 py-1"
                disabled={header?.status === "confirmed"}
              />
            </label>
            <label>納品先ID
              <input
                value={headerDraft.destinationId}
                onChange={(e)=> setHeaderDraft(d => ({ ...d, destinationId: e.target.value }))}
                className="border rounded px-2 py-1 w-28"
                placeholder="0001"
                disabled={isLocked}
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className="border rounded px-2"
                disabled={isLocked}
                onClick={() => setStoreModalOpen(true)}
              >選択</button>
            </div>
            <label>納品先名
              <input
                value={headerDraft.destinationName}
                onChange={(e)=> setHeaderDraft(d => ({ ...d, destinationName: e.target.value }))}
                className="border rounded px-2 py-1 w-44"
                disabled={header?.status === "confirmed"}
              />
            </label>
            <label>ベンダー
              <input
                value={headerDraft.vendorId}
                onChange={(e)=> setHeaderDraft(d => ({ ...d, vendorId: e.target.value }))}
                onBlur={(e)=> setHeaderDraft(d => ({ ...d, vendorId: ID.vendor(e.target.value) }))}
                className="border rounded px-2 py-1 w-28"
                disabled={isLocked || !canEditVendor}   // ← ここがポイント
                title={!canEditVendor ? "（既存伝票は管理者のみ編集可能／新規は誰でも可）" : ""}
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className="border rounded px-2"
                disabled={isLocked || !canEditVendor}
                onClick={() => setVendorModalOpen(true)}
                title={!canEditVendor ? "既存伝票は管理者のみ編集可能／新規は誰でも可" : ""}
              >
                選択
              </button>
            </div>
            <button
              className="border rounded px-3 py-1 ml-auto"
              disabled={isLocked || saving}
              onClick={onSave}
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      <div style={{ overflow: "auto", maxHeight: "60vh" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>品目</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>規格</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>温度帯</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px", textAlign:"right" }}>受注数</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px", textAlign:"right" }}>出荷数</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>単位</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>ロット</th>
              <th style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l: VendorOrderLine, i: number) => (
              <tr key={l.lineId}>
                <td style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>
                <input
                  list="master-items"
                  value={l.itemId}
                  onFocus={() => setActiveRow(i)}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    // const m = itemsForPick.find(x => x.id === v);
                    const m = itemsForPick.find((x: MasterItem) => x.id === v);
                    setLines(prev => prev.map((x, idx) => {
                      if (idx !== i) return x;
                      return m ? {
                        ...x,
                        itemId: m.id,
                        itemName: m.name ?? "",
                        unit: m.unit ?? "",
                        spec: m.spec ?? "",
                        tempZone: (m.tempZone ?? undefined),
                      } : { ...x, itemId: v };
                    }));
                  }}
                  className="border rounded px-2 py-1 w-36"
                  placeholder="品目コード（先頭入力で候補）"
                  disabled={isLocked}
                />
                <button
                  type="button"
                  className="border rounded px-2 ml-2 h-8"
                  disabled={isLocked}
                  onClick={() => { setActiveRow(i); setItemModalOpen(true); }}
                >選択</button>
                <div className="text-xs text-slate-500 mt-1">{l.itemName || ""}</div>
                </td>
                {/* 品目コード（既存のままでOK） */}
                {/* 規格 */}
                <td style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>
                  <input
                    value={l.spec || ""} disabled={isLocked}
                    onChange={(e)=> setLines(prev => prev.map((x,idx)=> idx===i ? { ...x, spec: e.target.value } : x))}
                    className="border rounded px-2 py-1 w-28"
                  />
                </td>
                {/* 温度帯 */}
                <td style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>
                  <select
                    value={l.tempZone ?? ""} disabled={isLocked}
                    onChange={(e)=> setLines(prev => prev.map((x,idx)=> idx===i ? { ...x, tempZone: (e.target.value || undefined) as TempZone | undefined } : x))}
                    className="border rounded px-2 py-1 w-24"
                  >
                  {TEMP_ZONES.map((z) => (
                    <option key={z} value={z}>
                      {TEMP_ZONE_LABEL[z]}
                    </option>
                  ))}
                  </select>
                </td>
                {/* 受注数 */}
                <td style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px", textAlign:"right" }}>{l.orderedQty}</td>
                {/* 出荷数 */}
                <td style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px", textAlign:"right" }}>
                  <input
                    type="number"
                    value={l.shipQty}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQty(i, Number(e.target.value))}
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === "Enter") {
                        const nx = document.querySelector<HTMLInputElement>(`input[data-idx='${i+1}']`);
                        nx?.focus();
                      }
                    }}
                    data-idx={i}
                    className="border rounded px-2 py-1 w-24"
                    style={{ textAlign:"right" }}
                    disabled={isLocked}
                  />
                </td>
                {/* 単位 */}
                <td style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>
                  <input
                    value={l.unit || ""} disabled={isLocked}
                    onChange={(e)=> setLines(prev => prev.map((x,idx)=> idx===i ? { ...x, unit: e.target.value } : x))}
                    className="border rounded px-2 py-1 w-20"
                  />
                </td>
                {/* ロット */}
                <td style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>
                  <input
                    value={l.lotNo || ""} disabled={isLocked}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setLines((prev: VendorOrderLine[]) =>
                        prev.map((x: VendorOrderLine, idx: number) => (idx === i ? { ...x, lotNo: e.target.value } : x))
                      )
                    }
                    className="border rounded px-2 py-1 w-28"
                  />
                </td>
                <td style={{ borderBottom:"1px solid #e2e8f0", padding:"6px 8px" }}>
                  <button
                    className="border rounded px-2 py-1 text-red-600"
                    disabled={isLocked}
                    onClick={async () => {
                      // 既存行（DBに存在する＝header.id && l.itemId が非空）の場合はサーバも削除
                      if (header?.id && l.itemId) {
                        await deleteLine(header.id, ID.item(l.itemId));
                      }
                      // 画面から行を除去
                      setLines(prev => prev.filter((_, idx) => idx !== i));
                    }}
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr><td colSpan={7} style={{ color:"#64748b", padding:"8px" }}>明細がありません。</td></tr>
            )}
          </tbody>
        </table> 
      </div>
      <datalist id="master-items">
        {itemsForPick.map((m: MasterItem) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </datalist>

      <div className="mt-2">
        <button
          className="border rounded px-3 py-1"
          onClick={() =>
            setLines(prev => {
              // 既存の lineId を走査して最大番号を取得
              const maxN = prev.reduce((m, x) => {
                const n = parseInt(String(x.lineId).replace(/^VOL-/, ""), 10);
                return isNaN(n) ? m : Math.max(m, n);
              }, 0);
              const nextId = `VOL-${String(maxN + 1).padStart(3, "0")}`;

              // 新しい行を追加
              return [
                ...prev,
                {
                  lineId: nextId,
                  shipmentId: headerIdUse,
                  itemId: "",
                  itemName: "",
                  unit: "",
                  orderedQty: 0,
                  shipQty: 0,
                  spec: "",
                  tempZone: undefined,
                  note: "",
                  lotNo: "",
                },
              ];
            })
          }
        >
          ＋ 行を追加
        </button>
      </div>
      <div className="flex justify-end items-center gap-6">
        <div>合計出荷数: <b>{subtotal}</b></div>
      </div>
      {storeModalOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={()=>setStoreModalOpen(false)}>
          <div className="bg-white rounded-xl p-3 w-[520px] max-h-[70vh] overflow-auto" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <b>納品先を選択</b>
              <input className="border rounded px-2 py-1 ml-auto" placeholder="絞り込み" value={storeFilter} onChange={e=>setStoreFilter(e.target.value)} />
            </div>
            <table className="w-full text-sm">
              <tbody>
                {stores.length === 0 && (
                      <tr><td className="px-2 py-2 text-slate-500" colSpan={2}>マスタ0件（/master/stores）</td></tr>
                    )}    
                {stores
                  .filter(s => (s.id + (s.name||'')).includes(storeFilter))
                  .map(s => (
                    <tr key={s.id} className="cursor-pointer hover:bg-slate-50"
                        onClick={() => {
                          setHeaderDraft(d => ({ ...d, destinationId: s.id, destinationName: s.name ?? '' }));
                          setStoreModalOpen(false);
                        }}>
                      <td className="border-b px-2 py-1 font-mono">{s.id}</td>
                      <td className="border-b px-2 py-1">{s.name}</td>
                    </tr>
                ))}
              </tbody>
            </table>
            <div className="text-right mt-2">
              <button className="border rounded px-3 py-1" onClick={()=>setStoreModalOpen(false)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
      {itemModalOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={()=>setItemModalOpen(false)}>
          <div className="bg-white rounded-xl p-3 w-[720px] max-h-[70vh] overflow-auto" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <b>品目を選択</b>
              <input className="border rounded px-2 py-1 ml-auto" placeholder="コード/名称で絞り込み" value={itemFilter} onChange={e=>setItemFilter(e.target.value)} />
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left px-2 py-1">コード</th>
                  <th className="text-left px-2 py-1">名称</th>
                  <th className="text-left px-2 py-1">規格</th>
                  <th className="text-left px-2 py-1">単位</th>
                  <th className="text-left px-2 py-1">温度帯</th>
                </tr>
              </thead>
              <tbody>
                {(itemsForPick.length === 0) && (
                  <tr><td className="px-2 py-2 text-slate-500" colSpan={5}>品目マスタがありません</td></tr>
                )}

                {itemsForPick
                  .filter((m: MasterItem) => (m.id + (m.name||'') + (m.spec||'')).includes(itemFilter))
                  .map((m: MasterItem) => (
                    <tr key={m.id} className="cursor-pointer hover:bg-slate-50"
                        onClick={() => {
                          setLines(prev => {
                            if (activeRow == null || activeRow < 0 || activeRow >= prev.length) return prev;
                            const next = [...prev];
                            next[activeRow] = {
                              ...next[activeRow],
                              itemId: m.id,
                              itemName: m.name ?? '',
                              unit: m.unit ?? '',
                              spec: m.spec ?? '',
                              tempZone: (m.tempZone ?? undefined),
                            };
                            return next;
                          });
                          setItemModalOpen(false);
                        }}>
                      <td className="border-b px-2 py-1 font-mono">{m.id}</td>
                      <td className="border-b px-2 py-1">{m.name}</td>
                      <td className="border-b px-2 py-1">{m.spec ?? ''}</td>
                      <td className="border-b px-2 py-1">{m.unit ?? ''}</td>
                      <td className="border-b px-2 py-1">{m.tempZone ?? ''}</td>
                    </tr>
                ))}
              </tbody>
            </table>
            <div className="text-right mt-2">
              <button className="border rounded px-3 py-1" onClick={()=>setItemModalOpen(false)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
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
                        setHeaderDraft(d => ({ ...d, vendorId: v.id }));
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

