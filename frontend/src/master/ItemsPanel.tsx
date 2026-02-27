import { useEffect, useMemo, useState, useRef } from "react";
import { ApiHttpError, importItemsCsv, listItems, padItemId, upsertItem, type ImportItemsCsvResult, type MasterItem } from "./apiMaster";
import { TEMP_ZONES, TEMP_ZONE_LABEL, toTempZoneOrUndef } from "../domain/codes";
import type { TempZone } from "../domain/codes";

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

export default function ItemsPanel() {
  const [loading, setLoading] = useState(false);

  const [includeInactive, setIncludeInactive] = useState(true);
  const [q, setQ] = useState("");

  const [rows, setRows] = useState<MasterItem[]>([]);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [importCsv, setImportCsv] = useState<string>("");
  const [importFileName, setImportFileName] = useState<string>("");
  const [importResult, setImportResult] = useState<ImportItemsCsvResult | null>(null);

  // form
  const [editId, setEditId] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [unit, setUnit] = useState<string>("");
  const [spec, setSpec] = useState<string>("");
  // const [tempZone, setTempZone] = useState<TempZone>("ambient");
  const DEFAULT_TEMP_ZONE: TempZone = TEMP_ZONES[0];
  const [tempZone, setTempZone] = useState<TempZone>(DEFAULT_TEMP_ZONE);
  const [isActive, setIsActive] = useState<0 | 1>(1);
  const [stockUnit, setStockUnit] = useState<string>("");
  const [stockConv, setStockConv] = useState<string>("1");

  async function reload() {
    setLoading(true);
    try {
      const list = await listItems({ includeInactive });
      setRows(list);
    } catch (e: unknown) {
      if (e instanceof ApiHttpError) {
        alert(`取得に失敗しました: ${e.status} ${e.statusText}\n${JSON.stringify(e.body)}`);
        return;
      }
      alert(`取得に失敗しました: ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeInactive]);

  const filtered = useMemo(() => {
    const qq = norm(q).toLowerCase();
    if (!qq) return rows;
    return rows.filter((r) => {
      const hit =
        r.id.toLowerCase().includes(qq) ||
        (r.name ?? "").toLowerCase().includes(qq) ||
        (r.spec ?? "").toLowerCase().includes(qq) ||
        (r.unit ?? "").toLowerCase().includes(qq);
      return hit;
    });
  }, [rows, q]);

  function resetForm() {
    setEditId("");
    setName("");
    setUnit("");
    setSpec("");
    setTempZone(DEFAULT_TEMP_ZONE);
    setIsActive(1);
    setStockUnit("");
    setStockConv("1");
  }

  function loadToForm(r: MasterItem) {
    setEditId(r.id);
    setName(r.name ?? "");
    setUnit(r.unit ?? "");
    setSpec(r.spec ?? "");
    setTempZone(toTempZoneOrUndef(r.tempZone) ?? DEFAULT_TEMP_ZONE);
    setIsActive((r.isActive ?? 1) as 0 | 1);
    setStockUnit(r.stockUnit ?? "");
    setStockConv(String(r.stockConv ?? 1));
  }

  async function onSave() {
    const id = padItemId(editId);
    const nm = norm(name);
    const un = norm(unit);
    const sp = norm(spec);
    const su = norm(stockUnit);
    const sc = Number(stockConv);

    if (!id) return alert("品目IDは必須です。");
    if (!nm) return alert("名称は必須です。");
    if (!un) return alert("単位(unit)は必須です。");
    if (!Number.isFinite(sc) || sc <= 0) return alert("在庫換算(stockConv)は 0 より大きい数値にしてください。");

    try {
      await upsertItem({
        id,
        name: nm,
        unit: un,
        spec: sp === "" ? null : sp,
        tempZone,
        isActive,
        stockUnit: su === "" ? null : su,
        stockConv: sc,
      });
      alert("保存しました。");
      await reload();
    } catch (e: unknown) {
      if (e instanceof ApiHttpError) {
        alert(`保存に失敗しました: ${e.status} ${e.statusText}\n${JSON.stringify(e.body)}`);
        return;
      }
      alert(`保存に失敗しました: ${errorMessage(e)}`);
    }
  }

  async function runImport(dryRun: boolean, csvText?: string) {
    const csv = (csvText ?? importCsv) || "";
    if (!csv.trim()) return alert("CSVが未選択です。");
    setImporting(true);
    try {
      const r = await importItemsCsv({ csv, dryRun });
      setImportResult(r);
      if (r.errors?.length) {
        const e0 = r.errors[0];
        alert(`検証NG: errors=${r.errors.length}\n例）${e0.line}行目 ${e0.field ?? ""} ${e0.message}`);
        return;
      }
      if (dryRun) {
        alert(`検証OK: rows=${r.rows}, insert=${r.inserted}, update=${r.updated}`);
      } else {
        alert(`適用OK: rows=${r.rows}, insert=${r.inserted}, update=${r.updated}`);
        await reload();
      }
    } catch (e: unknown) {
      if (e instanceof ApiHttpError) {
        alert(`取込に失敗しました: ${e.status} ${e.statusText}\n${JSON.stringify(e.body)}`);
        return;
      }
      alert(`取込に失敗しました: ${errorMessage(e)}`);
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

  function onDownloadCsv() {
    const qs = includeInactive ? "?includeInactive=1" : "?includeInactive=0";
    window.open(`/master/items.csv${qs}`, "_blank");
  }

  return (
    <div className="space-y-3">
      <div className="text-lg font-semibold">品目（items）</div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => void onPickCsvFile(e.target.files?.[0])}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          非稼働も含める
        </label>

        <input
          className="border rounded px-3 py-1 text-sm"
          placeholder="検索（ID / 名称 / 規格 / 単位）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <button type="button" className="border rounded px-3 py-1 text-sm" onClick={reload} disabled={loading}>
          再読込
        </button>

        <button type="button" className="border rounded px-3 py-1 text-sm" onClick={onDownloadCsv}>
          CSV
        </button>

        <button
          type="button"
          className="border rounded px-3 py-1 text-sm"
          onClick={() => fileRef.current?.click()}
          disabled={importing}
        >
          CSV取込
        </button>
        <button
          type="button"
          className="border rounded px-3 py-1 text-sm"
          onClick={() => void runImport(false)}
          disabled={importing || !importCsv.trim() || (importResult?.errors?.length ?? 0) > 0}
          title="検証がOKのときだけ有効"
        >
          適用
        </button>

        <button type="button" className="border rounded px-3 py-1 text-sm" onClick={resetForm}>
          新規入力
        </button>
      </div>

      {(importFileName || importResult) && (
        <div className="text-xs text-slate-600">
          取込: {importFileName || "（未選択）"} / rows={importResult?.rows ?? "-"} / errors={importResult?.errors?.length ?? "-"}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* list */}
        <div className="border rounded p-2">
          <div className="text-sm font-semibold mb-2">一覧（クリックで編集）</div>
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b">
                  <th className="text-left p-1">ID</th>
                  <th className="text-left p-1">名称</th>
                  <th className="text-left p-1">単位</th>
                  <th className="text-left p-1">温度帯</th>
                  <th className="text-left p-1">稼働</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b hover:bg-gray-50 cursor-pointer"
                    onClick={() => loadToForm(r)}
                    title="クリックで編集へ"
                  >
                    <td className="p-1 font-mono">{r.id}</td>
                    <td className="p-1">{r.name}</td>
                    <td className="p-1">{r.unit}</td>
                    <td className="p-1">{r.tempZone}</td>
                    <td className="p-1">{r.isActive === 1 ? "1" : "0"}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td className="p-2 text-gray-500" colSpan={5}>
                      該当なし
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* form */}
        <div className="border rounded p-2 space-y-2">
          <div className="text-sm font-semibold">編集</div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              品目ID（6桁）
              <input
                className="border rounded px-3 py-1 w-full"
                value={editId}
                onChange={(e) => setEditId(e.target.value)}
                placeholder="例: 001001"
              />
            </label>

            <label className="text-sm">
              稼働
              <select
                className="border rounded px-3 py-1 w-full"
                value={String(isActive)}
                onChange={(e) => setIsActive(e.target.value === "1" ? 1 : 0)}
              >
                <option value="1">1（稼働）</option>
                <option value="0">0（停止）</option>
              </select>
            </label>

            <label className="text-sm col-span-2">
              名称
              <input className="border rounded px-3 py-1 w-full" value={name} onChange={(e) => setName(e.target.value)} />
            </label>

            <label className="text-sm">
              単位（unit）
              <input className="border rounded px-3 py-1 w-full" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </label>
            <label className="text-sm">
              温度帯（tempZone）
              <select
                className="border rounded px-3 py-1 w-full"
                value={tempZone}
                onChange={(e) => setTempZone(toTempZoneOrUndef(e.target.value) ?? DEFAULT_TEMP_ZONE)}
              >
                {TEMP_ZONES.map((z) => (
                  <option key={z} value={z}>
                    {TEMP_ZONE_LABEL[z]}（{z}）
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm col-span-2">
              規格（spec）
              <input className="border rounded px-3 py-1 w-full" value={spec} onChange={(e) => setSpec(e.target.value)} />
            </label>

            <label className="text-sm">
              在庫単位（stockUnit）
              <input
                className="border rounded px-3 py-1 w-full"
                value={stockUnit}
                onChange={(e) => setStockUnit(e.target.value)}
                placeholder="空=unitと同等"
              />
            </label>

            <label className="text-sm">
              在庫換算（stockConv）
              <input
                className="border rounded px-3 py-1 w-full"
                value={stockConv}
                onChange={(e) => setStockConv(e.target.value)}
                placeholder="例: 1"
              />
            </label>
          </div>

          <div className="flex gap-2">
            <button type="button" className="border rounded px-3 py-1" onClick={onSave} disabled={loading}>
              保存
            </button>
            <div className="text-xs text-gray-600 self-center">
              ※ 参照があるので削除はせず、稼働(0/1)で制御
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
