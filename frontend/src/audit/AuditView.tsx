// frontend/src/audit/AuditView.tsx

import { useEffect, useMemo, useState } from "react";
import {
  searchAudit,
  type AuditEvent,
  type AuditEventType,
} from "../auditlog";
import { downloadAuditCsv } from "./auditCsv";
import {
  listStores,
  listVendors,
  type MasterStore,
  type MasterVendor,
} from "../vendor/apiVendor";
import { AUDIT_EVENT_TYPES, AUDIT_EVENT_TYPE_LABEL } from "./auditCodes";


// 日付範囲バリデーション（YYYY-MM-DD 前提）
function validateDateRange(from: string, to: string): string | null {
  if (from && to && from > to) {
    return "日付(自)が日付(至)より後になっています。";
  }
  return null;
}

export default function AuditView() {
  // 日付は「初期は空」（＝全期間）にしておく
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const [type, setType] = useState<AuditEventType | "">("");
  const [shipmentId, setShipmentId] = useState('');
  const [inspectionId, setInspectionId] = useState('');
  const [vendorId, setVendorId] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [destinationName, setDestinationName] = useState("");

  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  // ベンダーモーダル
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [vendors, setVendors] = useState<MasterVendor[]>([]);
  const [vendorFilter, setVendorFilter] = useState("");

  // 納品先モーダル
  const [storeModalOpen, setStoreModalOpen] = useState(false);
  const [stores, setStores] = useState<MasterStore[]>([]);
  const [storeFilter, setStoreFilter] = useState("");

  // ベンダー一覧ロード
  useEffect(() => {
    if (!vendorModalOpen) return;
    if (vendors.length > 0) return;
    (async () => {
      try {
        const list = await listVendors();
        setVendors(list);
      } catch (e) {
        console.error("[AuditView] listVendors error", e);
      }
    })();
  }, [vendorModalOpen, vendors.length]);

  // 店舗一覧ロード
  useEffect(() => {
    if (!storeModalOpen) return;
    if (stores.length > 0) return;
    (async () => {
      try {
        const list = await listStores();
        setStores(list);
      } catch (e) {
        console.error("[AuditView] listStores error", e);
      }
    })();
  }, [storeModalOpen, stores.length]);

  const filteredVendors = useMemo(() => {
    const kw = vendorFilter.trim();
    if (!kw) return vendors;
    return vendors.filter((v) =>
      (v.id + (v.name || "")).includes(kw)
    );
  }, [vendors, vendorFilter]);

  const filteredStores = useMemo(() => {
    const kw = storeFilter.trim();
    if (!kw) return stores;
    return stores.filter((s) =>
      (s.id + (s.name || "")).includes(kw)
    );
  }, [stores, storeFilter]);

  // 検索本体（API 呼び出し）
  async function doSearch() {
    const msg = validateDateRange(dateFrom, dateTo);
    if (msg) {
      setError(msg);
      setRows([]);   // 一応一覧もクリアしておく
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await searchAudit({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        type: (type || undefined) as AuditEventType | undefined,
        shipmentId: shipmentId.trim() || undefined,
        inspectionId: inspectionId || undefined,
        vendorId: vendorId.trim() || undefined,
        destinationId: destinationId.trim() || undefined,
      });
      setRows(list);
    } catch (e: unknown) {
      console.error("[AuditView] searchAudit error", e);
      
      // ★ エラーメッセージの取り出しだけ型ガード
      const message =
        e instanceof Error ? e.message : String(e);

      setError(message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  // 条件リセット（全期間・全条件）
  async function handleReset() {
    setDateFrom("");
    setDateTo("");
    setType("");
    setShipmentId("");
    setInspectionId('');
    setVendorId("");
    setVendorName("");
    setDestinationId("");
    setDestinationName("");
    await doSearch();
  }

  // 初回表示時に一度だけ検索
  useEffect(() => {
    (async () => {
      await doSearch();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-3">
      <h1 className="text-xl font-bold mb-3">監査ログ</h1>

      {/* 検索条件 */}
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="text-sm">
          日付(自)
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setError(null);
            }}
            className="border rounded px-2 py-1 block"
          />
        </label>
        <label className="text-sm">
          日付(至)
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setError(null);
            }}
            className="border rounded px-2 py-1 block"
          />
        </label>

        <label className="text-sm">
          種別
          <select
            value={type}
            onChange={(e) =>
              setType(
                (e.target.value || "") as AuditEventType | ""
              )
            }
            className="border rounded px-2 py-1 block"
          >
            <option value="">(すべて)</option>
            {AUDIT_EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {AUDIT_EVENT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          伝票番号
          <input
            value={shipmentId}
            onChange={(e) => setShipmentId(e.target.value)}
            className="border rounded px-2 py-1 w-44 block"
            placeholder="検品ID / 出荷ID など"
          />
        </label>

        <label className="text-xs">検品ID</label>
        <input className="border rounded px-2 py-1" value={inspectionId} onChange={(e)=>setInspectionId(e.target.value)} />

        {/* ベンダー条件 */}
        <div className="text-sm">
          <div className="mb-1">ベンダー</div>
          <div className="flex gap-1">
            <input
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              className="border rounded px-2 py-1 w-24"
              placeholder="ID"
            />
            <input
              value={vendorName}
              readOnly
              className="border rounded px-2 py-1 w-44 bg-slate-50"
              placeholder="ベンダー名"
            />
            <button
              type="button"
              className="border rounded px-2 py-1 text-sm"
              onClick={() => setVendorModalOpen(true)}
            >
              選択
            </button>
            <button
              type="button"
              className="border rounded px-2 py-1 text-sm"
              onClick={() => {
                setVendorId("");
                setVendorName("");
              }}
            >
              クリア
            </button>
          </div>
        </div>

        {/* 納品先条件 */}
        <div className="text-sm">
          <div className="mb-1">納品先</div>
          <div className="flex gap-1">
            <input
              value={destinationId}
              onChange={(e) => setDestinationId(e.target.value)}
              className="border rounded px-2 py-1 w-24"
              placeholder="ID"
            />
            <input
              value={destinationName}
              readOnly
              className="border rounded px-2 py-1 w-44 bg-slate-50"
              placeholder="店舗名"
            />
            <button
              type="button"
              className="border rounded px-2 py-1 text-sm"
              onClick={() => setStoreModalOpen(true)}
            >
              選択
            </button>
            <button
              type="button"
              className="border rounded px-2 py-1 text-sm"
              onClick={() => {
                setDestinationId("");
                setDestinationName("");
              }}
            >
              クリア
            </button>
          </div>
        </div>

        <button
          className="border rounded px-3 py-1"
          type="button"
          onClick={doSearch}
          disabled={loading}
        >
          {loading ? "検索中..." : "検索"}
        </button>

        <button
          className="border rounded px-3 py-1"
          type="button"
          onClick={() =>
            downloadAuditCsv(rows, {
              includeHeader: true,
              delimiter: ",",
              filename: `audit_${dateFrom || "all"}_${dateTo || "all"}.csv`,
            })
          }
          disabled={rows.length === 0}
        >
          CSV出力
        </button>

        <button
          className="border rounded px-3 py-1"
          type="button"
          onClick={handleReset}
          disabled={loading}
        >
          条件リセット
        </button>
      </div>

      {/* ステータス表示 */}
      <div className="text-sm text-slate-600 mb-2">
        {loading && <span>検索中...</span>}
        {!loading && (
          <span>検索結果: {rows.length} 件</span>
        )}
        {error && (
          <span className="text-red-600 ml-4">
            エラー: {error}
          </span>
        )}
      </div>

      {/* 一覧 */}
      <table className="w-full border-collapse table-fixed">
        <colgroup>
          <col style={{ width: 180 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 140 }} />
          <col style={{ width: 140 }} />
          <col style={{ width: 160 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 120 }} />
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
          {rows.map((r) => (
            <tr
              key={r.id}
              className="[&>td]:border-b [&>td]:py-1 [&>td]:px-2 text-sm hover:bg-slate-50 cursor-pointer"
              onClick={() => {
                setSelected(r);
                setDetailOpen(true);
              }}
              title="クリックで詳細表示"
            >
              <td>{r.at.replace("T", " ").replace("Z", "")}</td>
              <td>{r.actor}</td>
              <td>{AUDIT_EVENT_TYPE_LABEL[r.type] ?? r.type}</td>
              <td className="font-mono">{r.shipmentId}</td>
              <td>
                {r.destinationId} {r.destinationName ?? ""}
              </td>
              <td>{r.vendorId}</td>
              <td>{r.deliveryDate}</td>
              <td className="truncate">{r.memo ?? ""}</td>
            </tr>
          ))}
          {rows.length === 0 && !loading && (
            <tr>
              <td
                colSpan={8}
                className="text-center text-slate-500 py-6"
              >
                該当なし
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* 詳細モーダル */}
      {detailOpen && selected && (
        <div
          className="fixed inset-0 bg-black/30 flex items-center justify-center z-40"
          onClick={() => setDetailOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-lg p-4 w-[480px] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-lg">ログ詳細</h2>
              <button
                className="px-2 py-1 text-sm border rounded"
                onClick={() => setDetailOpen(false)}
              >
                閉じる
              </button>
            </div>
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <th className="text-left w-28 align-top pr-2 py-1 text-slate-500">
                    日時
                  </th>
                  <td className="py-1">
                    {selected.at
                      .replace("T", " ")
                      .replace("Z", "")}
                  </td>
                </tr>
                <tr>
                  <th className="text-left w-28 align-top pr-2 py-1 text-slate-500">
                    ユーザー
                  </th>
                  <td className="py-1">{selected.actor}</td>
                </tr>
                <tr>
                  <th className="text-left w-28 align-top pr-2 py-1 text-slate-500">
                    種別
                  </th>
                  <td className="py-1">
                    {AUDIT_EVENT_TYPE_LABEL[selected.type] ??
                      selected.type}
                  </td>
                </tr>
                <tr>
                  <th className="text-left w-28 align-top pr-2 py-1 text-slate-500">
                    伝票番号
                  </th>
                  <td className="py-1 font-mono">
                    {selected.shipmentId}
                  </td>
                </tr>
                <tr>
                  <th className="text-left w-28 align-top pr-2 py-1 text-slate-500">
                    納品先
                  </th>
                  <td className="py-1">
                    {selected.destinationId}{" "}
                    {selected.destinationName ?? ""}
                  </td>
                </tr>
                <tr>
                  <th className="text-left w-28 align-top pr-2 py-1 text-slate-500">
                    ベンダー
                  </th>
                  <td className="py-1">{selected.vendorId}</td>
                </tr>
                <tr>
                  <th className="text-left w-28 align-top pr-2 py-1 text-slate-500">
                    納品日
                  </th>
                  <td className="py-1">
                    {selected.deliveryDate}
                  </td>
                </tr>
                <tr>
                  <th className="text-left w-28 align-top pr-2 py-1 text-slate-500">
                    メモ
                  </th>
                  <td className="py-1 whitespace-pre-wrap">
                    {selected.memo ?? ""}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ベンダー選択モーダル */}
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
                className="border rounded px-2 py-1 ml-auto text-sm"
                placeholder="ID/名称で絞り込み"
                value={vendorFilter}
                onChange={(e) =>
                  setVendorFilter(e.target.value)
                }
              />
            </div>

            <table className="w-full text-sm">
              <tbody>
                {filteredVendors.map((v) => (
                  <tr
                    key={v.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => {
                      setVendorId(v.id);
                      setVendorName(v.name ?? "");
                      setVendorModalOpen(false);
                    }}
                  >
                    <td className="px-2 py-1 w-24 font-mono">
                      {v.id}
                    </td>
                    <td className="px-2 py-1">{v.name}</td>
                  </tr>
                ))}
                {filteredVendors.length === 0 && (
                  <tr>
                    <td
                      colSpan={2}
                      className="px-2 py-4 text-center text-slate-500"
                    >
                      該当なし
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="mt-3 text-right">
              <button
                className="border rounded px-3 py-1 text-sm"
                onClick={() => setVendorModalOpen(false)}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 納品先選択モーダル */}
      {storeModalOpen && (
        <div
          className="fixed inset-0 bg-black/30 flex items-center justify-center z-50"
          onClick={() => setStoreModalOpen(false)}
        >
          <div
            className="bg-white rounded-xl p-3 w-[520px] max-h-[70vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-2">
              <b>納品先を選択</b>
              <input
                className="border rounded px-2 py-1 ml-auto text-sm"
                placeholder="ID/店舗名で絞り込み"
                value={storeFilter}
                onChange={(e) =>
                  setStoreFilter(e.target.value)
                }
              />
            </div>

            <table className="w-full text-sm">
              <tbody>
                {filteredStores.map((s) => (
                  <tr
                    key={s.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => {
                      setDestinationId(s.id);
                      setDestinationName(s.name ?? "");
                      setStoreModalOpen(false);
                    }}
                  >
                    <td className="px-2 py-1 w-24 font-mono">
                      {s.id}
                    </td>
                    <td className="px-2 py-1">{s.name}</td>
                  </tr>
                ))}
                {filteredStores.length === 0 && (
                  <tr>
                    <td
                      colSpan={2}
                      className="px-2 py-4 text-center text-slate-500"
                    >
                      該当なし
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="mt-3 text-right">
              <button
                className="border rounded px-3 py-1 text-sm"
                onClick={() => setStoreModalOpen(false)}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
