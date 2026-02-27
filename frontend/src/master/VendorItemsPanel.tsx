import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiHttpError,
  listItems,
  listVendors,
  padItemId,
  padVendorId,
  replaceCurrentVendorItemPeriods,
  toggleVendorItemPeriods,
  listVendorItemPeriods,
  importVendorItemsCsv,
  type MasterItem,
  type VendorLite,
  type ImportVendorItemsCsvResult
} from "./apiMaster";


function ymdLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function norm(s: string) {
  return String(s ?? "").trim();
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export default function VendorItemsPanel() {
  const [loading, setLoading] = useState(false);

  const [vendors, setVendors] = useState<VendorLite[]>([]);
  const [items, setItems] = useState<MasterItem[]>([]);

  const [vendorId, setVendorId] = useState<string>("");
  const [asOf, setAsOf] = useState<string>(() => ymdLocal(new Date()));
  const [validFrom, setValidFrom] = useState<string>(() => ymdLocal(new Date()));
  const [includeHistory, setIncludeHistory] = useState(false);

  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [baselineSelected, setBaselineSelected] = useState<Set<string>>(new Set());
  const [diffSave, setDiffSave] = useState(false);

    // CSV import（items と同じ）
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [importCsv, setImportCsv] = useState<string>("");
  const [importFileName, setImportFileName] = useState<string>("");
  const [importResult, setImportResult] = useState<ImportVendorItemsCsvResult | null>(null);

  async function runImport(dryRun: boolean, csvText?: string) {
    const csv = (csvText ?? importCsv) || "";
    if (!csv.trim()) return alert("CSVが未選択です。");
    setImporting(true);
    try {
      const r = await importVendorItemsCsv({ csv, dryRun, validFrom });
      setImportResult(r);

      if (r.errors?.length) {
        const e0 = r.errors[0];
        alert(`検証NG: errors=${r.errors.length}\n例）${e0.line}行目 ${e0.field ?? ""} ${e0.message}`);
        return;
      }

      if (dryRun) {
        alert(`検証OK: rows=${r.rows}, groups=${r.groups}`);
      } else {
        alert(`適用OK: rows=${r.rows}, appliedGroups=${r.appliedGroups}, noOp=${r.noOpGroups}`);
        // 取込後は画面も更新
        await doSearch();
      }
      } catch (e: unknown) {
        if (e instanceof ApiHttpError) {
          alert(`取込に失敗しました: ${e.status} ${e.statusText}\n${JSON.stringify(e.body)}`);
          return;
        }
        const msg = e instanceof Error ? e.message : String(e);
        alert(`取込に失敗しました: ${msg}`);
      } finally {
        setImporting(false);
      }
  }

  async function onPickCsvFile(f: File | null | undefined) {
    if (!f) return;
    const text = await f.text();
    setImportFileName(f.name);
    setImportCsv(text);
    setImportResult(null);
    await runImport(true, text); // 選択後に自動で検証
  }

  // 初期ロード：vendors / items
  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const [vs, its] = await Promise.all([
          listVendors(),
          listItems({ includeInactive: false }), // 取扱は基本「稼働品目」だけ
        ]);
        setVendors(vs);
        setItems(its);
      } catch (e: unknown) {
        if (e instanceof ApiHttpError) {
          alert(`初期取得に失敗しました: ${e.status} ${e.statusText}\n${JSON.stringify(e.body)}`);
          return;
        }
        alert(`初期取得に失敗しました: ${errorMessage(e)}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    // asOf を変えた直後、validFrom が空なら asOf を初期値にする（勝手に上書きしない版）
    if (!validFrom && asOf) setValidFrom(asOf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asOf]);

  const vendorName = useMemo(() => {
    const vid = padVendorId(vendorId);
    const v = vendors.find((x) => x.id === vid);
    return v?.name ?? "";
  }, [vendors, vendorId]);

  // vendorId/asOf で現行取扱をロード
 useEffect(() => {
    const vid = norm(vendorId);
    if (!vid) {
      setSelected(new Set());
      return;
    }
    void loadSelection(vid, asOf);
  }, [vendorId, asOf]);

  async function loadSelection(vidRaw: string, asOfYmd: string) {
  const vid = norm(vidRaw);
  if (!vid) {
    setSelected(new Set());
    return;
  }

  setLoading(true);
  try {
    const rows = await listVendorItemPeriods({ vendorId: vid, asOf: asOfYmd });
    const set = new Set<string>();
    for (const r of rows) set.add(padItemId(r.itemId));
    setSelected(set);
    setBaselineSelected(set);
  } catch (e: unknown) {
    if (e instanceof ApiHttpError) {
      alert(`取扱取得に失敗しました: ${e.status} ${e.statusText}\n${JSON.stringify(e.body)}`);
      return;
    }
    alert(`取扱取得に失敗しました: ${errorMessage(e)}`);
  } finally {
    setLoading(false);
  }
}

  const filteredItems = useMemo(() => {
    const qq = norm(q).toLowerCase();
    if (!qq) return items;
    return items.filter((r) => {
      return (
        r.id.toLowerCase().includes(qq) ||
        (r.name ?? "").toLowerCase().includes(qq) ||
        (r.spec ?? "").toLowerCase().includes(qq) ||
        (r.unit ?? "").toLowerCase().includes(qq)
      );
    });
  }, [items, q]);

  function toggle(itemId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function setAllFiltered(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const it of filteredItems) {
        if (on) next.add(it.id);
        else next.delete(it.id);
      }
      return next;
    });
  }

  async function onSave() {
    const vid = padVendorId(vendorId);
    if (!vid) return alert("vendorId は必須です。");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) return alert("validFrom は YYYY-MM-DD で入力してください。");

    const itemIds = Array.from(selected.values()).map(padItemId);
    if (itemIds.length === 0) return alert("取扱品目が0件です。少なくとも1件選択してください。");

    setLoading(true);
    try {
      const r = await replaceCurrentVendorItemPeriods({ vendorId: vid, validFrom, itemIds });
      if (r.noOp) {
        alert("保存しました（変更なし）。");
      } else {
        alert(`保存しました（${r.count} 件）。`);
      }
      // 保存後：asOf を validFrom に合わせて読み直すと確認しやすい
      setAsOf(validFrom);
    } catch (e: unknown) {
      if (e instanceof ApiHttpError) {
        alert(`保存に失敗しました: ${e.status} ${e.statusText}\n${JSON.stringify(e.body)}`);
        return;
      }
      alert(`保存に失敗しました: ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function onSaveDiff() {
  const vid = padVendorId(vendorId);

  if (!vid) return alert("vendorId は必須です。");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) return alert("validFrom は YYYY-MM-DD で入力してください。");
  if (selected.size === 0) return alert("取扱品目が0件です。少なくとも1件選択してください。");

  // baseline(asOf) と selected(画面) の差分だけ投げる
  const union = new Set<string>([...baselineSelected, ...selected]);
  const changes: { itemId: string; enabled: boolean }[] = [];
  for (const id of union) {
    const before = baselineSelected.has(id);
    const after = selected.has(id);
    if (before !== after) changes.push({ itemId: id, enabled: after });
  }

  if (changes.length === 0) return alert("変更なしです。");

  setLoading(true);
  try {
    const r = await toggleVendorItemPeriods({ vendorId: vid, validFrom, changes });
    if (r.noOp || r.applied === 0) alert("保存しました（変更なし）。");
    else alert(`保存しました（差分 ${r.applied} 件）。`);
    setAsOf(validFrom); // 確認しやすい（useEffectで再ロード→baseline更新）
  } catch (e: unknown) {
    if (e instanceof ApiHttpError) {
      alert(`保存に失敗しました: ${e.status} ${e.statusText}\n${JSON.stringify(e.body)}`);
      return;
    }
    alert(`保存に失敗しました: ${errorMessage(e)}`);
  } finally {
    setLoading(false);
  }
}

  function onDownloadCsv(dateStyle: "iso" | "slash") {
    const vid = norm(vendorId);

    const qs = new URLSearchParams();
    if (vid) qs.set("vendorId", padVendorId(vid));
    if (!includeHistory && asOf) qs.set("asOf", asOf); // ★履歴込みなら asOf を付けない

    qs.set("dateStyle", dateStyle);
    window.open(`/master/vendor-items.csv?${qs.toString()}`, "_blank");
  } 

 async function doSearch() {
    const vid = norm(vendorId);
    if (!vid) {
      setSelected(new Set());
      return;
    }
    await loadSelection(vid, asOf);
  }

  return (
    <div className="space-y-3">
      <div className="text-lg font-semibold">ベンダー取扱品目（vendor_items）</div>

      <div className="flex flex-wrap gap-2 items-center">
        <label className="text-sm">
          vendorId
          <input
            className="border rounded px-3 py-1 ml-2"
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            list="vendors-list"
            placeholder="例: 100011"
          />
          <datalist id="vendors-list">
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </datalist>
        </label>

        <label className="text-sm">参照日（asOf）</label>
        <input
          type="date"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
          className="border rounded px-2 py-1"
        />
        <button
          type="button"
          className="border rounded px-3 py-1"
          onClick={() => void doSearch()}
        >
          検索
        </button>

        <div className="text-sm text-gray-600">{vendorName ? `：${vendorName}` : ""}</div>

        <label className="text-sm">
          反映開始（validFrom）
          <input
            type="date"
            className="border rounded px-3 py-1 ml-2"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
        </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="border rounded px-2 py-1 text-xs"
          onClick={() => setValidFrom(asOf)}
          disabled={!asOf}
        >
          validFrom ← asOf
        </button>

        <button
          type="button"
          className="border rounded px-2 py-1 text-xs"
          onClick={() => setAsOf(validFrom)}
          disabled={!validFrom}
        >
          asOf ← validFrom
        </button>
      </div>

        <button type="button" className="border rounded px-3 py-1" onClick={() => onDownloadCsv("iso")}>
          CSV (ISO)
        </button>
        <button type="button" className="border rounded px-3 py-1" onClick={() => onDownloadCsv("slash")}>
          CSV (Excel)
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => void onPickCsvFile(e.target.files?.[0])}
        />

        <button
          type="button"
          className="border rounded px-3 py-1"
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          title="vendor_items をCSV取込（検証→適用）"
        >
          CSV取込
        </button>
        <button
          type="button"
          className="border rounded px-3 py-1"
          onClick={() => void runImport(false)}
          disabled={importing || !importCsv.trim() || (importResult?.errors?.length ?? 0) > 0}
          title="検証がOKのときだけ有効"
        >
          適用
        </button>

        {(importFileName || importResult) && (
          <div className="text-xs text-slate-600">
            取込: {importFileName || "（未選択）"} / rows={importResult?.rows ?? "-"} / errors={importResult?.errors?.length ?? "-"}
          </div>
        )}

        <label className="text-sm flex items-center gap-2">
          <input type="checkbox" checked={diffSave} onChange={(e) => setDiffSave(e.target.checked)} />
          差分保存（トグル方式）
        </label>
        <label className="text-sm flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeHistory}
            onChange={(e) => setIncludeHistory(e.target.checked)}
          />
          履歴込み（asOfなし）
        </label>
        <button
          type="button"
          className="border rounded px-3 py-1 text-sm"
          onClick={() => (diffSave ? void onSaveDiff() : void onSave())}
          disabled={loading}
        >
          {diffSave ? "保存（差分）" : "保存（入替）"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          className="border rounded px-3 py-1 text-sm"
          placeholder="品目検索（ID/名称/規格/単位）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <button type="button" className="border rounded px-3 py-1 text-sm" onClick={() => setAllFiltered(true)}>
          表示中を全選択
        </button>
        <button type="button" className="border rounded px-3 py-1 text-sm" onClick={() => setAllFiltered(false)}>
          表示中を全解除
        </button>

        <div className="text-sm text-gray-600">選択：{selected.size} 件</div>
      </div>

      <div className="border rounded p-2">
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b">
                <th className="text-left p-1 w-[48px]">選択</th>
                <th className="text-left p-1">ID</th>
                <th className="text-left p-1">名称</th>
                <th className="text-left p-1">規格</th>
                <th className="text-left p-1">単位</th>
                <th className="text-left p-1">温度帯</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((it) => {
                const on = selected.has(it.id);
                return (
                  <tr key={it.id} className="border-b hover:bg-gray-50">
                    <td className="p-1">
                      <input type="checkbox" checked={on} onChange={() => toggle(it.id)} />
                    </td>
                    <td className="p-1 font-mono">{it.id}</td>
                    <td className="p-1">{it.name}</td>
                    <td className="p-1">{it.spec ?? ""}</td>
                    <td className="p-1">{it.unit}</td>
                    <td className="p-1">{it.tempZone}</td>
                  </tr>
                );
              })}
              {filteredItems.length === 0 && (
                <tr>
                  <td className="p-2 text-gray-500" colSpan={6}>
                    該当なし
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-gray-600 mt-2">
          ※ 保存は「現行を閉じて、validFrom からの現行セットを作る」方式です（不整合防止）。
        </div>
      </div>
    </div>
  );
}
