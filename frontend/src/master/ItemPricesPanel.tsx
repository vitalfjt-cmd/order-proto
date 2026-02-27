// frontend/src/master/ItemPricesPanel.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ApiHttpError,
  listVendors,
  listVendorItems,
  listItemPrices,
  padVendorId,
  padItemId,
  upsertItemPrice,
  importItemPricesCsv,
  type ImportItemPricesCsvResult,
  type VendorLite,
  type VendorItemLite,
  type ItemPriceRow,
} from "./apiMaster";

const norm = (s: string) => String(s ?? "").replace(/\D/g, "");

function ymdLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export default function ItemPricesPanel() {
  const [vendors, setVendors] = useState<VendorLite[]>([]);
  const [vendorId, setVendorId] = useState<string>("");
  const [vendorItems, setVendorItems] = useState<VendorItemLite[]>([]);
  const itemNameMap = useMemo(() => new Map(vendorItems.map((i) => [i.id, i.name])), [vendorItems]);

  const [itemId, setItemId] = useState<string>("");
  const [asOf, setAsOf] = useState<string>(() => ymdLocal(new Date()));
  const [includeHistory, setIncludeHistory] = useState(false);
  const [rows, setRows] = useState<ItemPriceRow[]>([]);
  const [loading, setLoading] = useState(false);
    // CSV import
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [importCsv, setImportCsv] = useState<string>("");
  const [importFileName, setImportFileName] = useState<string>("");
  const [importResult, setImportResult] = useState<ImportItemPricesCsvResult | null>(null);

  async function runImport(dryRun: boolean, csvText?: string) {
    const csv = (csvText ?? importCsv) || "";
    if (!csv.trim()) return alert("CSVが未選択です。");

    setImporting(true);
    try {
      const r = await importItemPricesCsv({ csv, dryRun });
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
        await onSearch(); // 反映
      }
    } catch (e: unknown) {
      if (e instanceof ApiHttpError) {
        alert(`取込に失敗しました: ${e.status} ${e.statusText}\n${JSON.stringify(e.body)}`);
        return;
      }
      alert(`取込に失敗しました: ${errText(e)}`);
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
    await runImport(true, text); // 選択後に自動検証
    if (fileRef.current) fileRef.current.value = "";
  }

  // edit form
  const [editId, setEditId] = useState<number | null>(null);
  const [unitPrice, setUnitPrice] = useState<string>("");
  const [validFrom, setValidFrom] = useState<string>("");
  const [validTo, setValidTo] = useState<string>("");

  useEffect(() => {
    void (async () => {
      const vs = await listVendors();
      setVendors(vs);
      if (vs[0]?.id) setVendorId(vs[0].id);
    })();
  }, []);

  useEffect(() => {
    if (!vendorId) return;
    void (async () => {
      const vid = padVendorId(vendorId);
      const its = await listVendorItems(vid).catch(() => [] as VendorItemLite[]);
      setVendorItems(its);
    })();
  }, [vendorId]);

  async function onSearch() {
    if (!vendorId) return;
    setLoading(true);
    try {
      const vid = padVendorId(vendorId);
      const iid = itemId ? padItemId(itemId) : undefined;
      const ao = asOf.trim() ? asOf.trim() : undefined;
      const list = await listItemPrices({ vendorId: vid, itemId: iid, asOf: ao });
      setRows(list);
    } catch (e: unknown) {
      if (e instanceof ApiHttpError) {
        alert(`検索に失敗しました: ${e.status} ${e.statusText}\n${JSON.stringify(e.body)}`);
        return;
      }
      alert(`検索に失敗しました: ${errText(e)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!vendorId) return;
    void onSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId, asOf]);

  // vendorId が変わったら編集フォームをクリア（事故防止）
  useEffect(() => {
    setEditId(null);
    setItemId("");
    setUnitPrice("");
    setValidFrom("");
    setValidTo("");
  }, [vendorId]);

  function resetForm() {
    setEditId(null);      // or setEditId(undefined)
    // setVendorId("");
    setItemId("");
    setUnitPrice("");
    setValidFrom("");
    setValidTo("");
  }

  function loadToForm(r: ItemPriceRow) {
    setEditId(r.id);
    setVendorId(r.vendorId);
    setItemId(r.itemId);
    setUnitPrice(String(r.unitPrice ?? ""));
    setValidFrom(r.validFrom ?? "");
    setValidTo(r.validTo ?? "");
  }

  async function onSave() {
    if (!vendorId || !itemId) {
      alert("vendorId / itemId は必須です。");
      return;
    }
    try {
      const up = Number(unitPrice);
      await upsertItemPrice({
        id: editId ?? undefined,
        vendorId,
        itemId,
        unitPrice: up,
        validFrom,
        validTo: validTo.trim() === "" ? null : validTo,
      });
      alert("保存しました。");
      await onSearch();
      resetForm();
    } catch (e: unknown) {
      if (e instanceof ApiHttpError) {
        alert(`保存に失敗しました: ${e.status} ${e.statusText}\n${JSON.stringify(e.body)}`);
        return;
      }
      alert(`保存に失敗しました: ${errText(e)}`);
    }
  }

  function onDownloadCsv(dateStyle: "iso" | "slash") {
    const vid = norm(vendorId);

    const qs = new URLSearchParams();
    if (vid) qs.set("vendorId", padVendorId(vid));
    const ao = asOf.trim();
    if (!includeHistory && ao) qs.set("asOf", ao); // ★履歴込みなら asOf を付けない
    qs.set("dateStyle", dateStyle);

    window.open(`/master/item-prices.csv?${qs.toString()}`, "_blank");
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">単価（期間）</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs text-slate-600 mb-1">ベンダー</div>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={padVendorId(vendorId)}
              onChange={(e) => setVendorId(e.target.value)}
            >
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id} {v.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-xs text-slate-600 mb-1">品目ID（任意）</div>
            <Input
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              placeholder="例: 001001"
              className="w-40"
              list="vendor-items-datalist"
            />
            <datalist id="vendor-items-datalist">
              {vendorItems.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </datalist>
          </div>

          <div>
            <div className="text-xs text-slate-600 mb-1">asOf（時点）</div>
            <Input
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="w-40"
            />
          </div>

          <button
            className="border rounded px-3 py-1 text-sm bg-slate-900 text-white disabled:opacity-60"
            disabled={loading}
            onClick={onSearch}
          >
            検索（再同期）
          </button>
          <button type="button" className="border rounded px-3 py-1" onClick={() => onDownloadCsv("iso")}>
            CSV (ISO)
          </button>
          <button type="button" className="border rounded px-3 py-1" onClick={() => onDownloadCsv("slash")}>
            CSV (Excel)
          </button>
          <label className="text-sm flex items-center gap-2 ml-2">
            <input
              type="checkbox"
              checked={includeHistory}
              onChange={(e) => setIncludeHistory(e.target.checked)}
            />
            履歴込み（asOfなし）
          </label>
        </div>
        {/* CSV取込 */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => void onPickCsvFile(e.target.files?.[0])}
          />
          <button
            type="button"
            className="border rounded px-3 py-1 text-sm"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
          >
            CSV取込
          </button>
          <button
            type="button"
            className="border rounded px-3 py-1 text-sm"
            disabled={importing || !importCsv.trim()}
            onClick={() => void runImport(true)}
          >
            検証
          </button>
          <button
            type="button"
            className="border rounded px-3 py-1 text-sm"
            disabled={importing || !importCsv.trim()}
            onClick={() => void runImport(false)}
          >
            適用
          </button>

          <span className="text-xs text-slate-600">
            {importFileName ? `選択: ${importFileName}` : "未選択"}
          </span>
          {importResult ? (
            <span className="text-xs text-slate-600">
              last: rows={importResult.rows}, ins={importResult.inserted}, upd={importResult.updated}, errs={importResult.errors.length}
            </span>
          ) : null}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Card className="shadow-none border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">編集</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-slate-600 mb-2">
                一覧の行をクリックすると編集フォームに読み込みます。
              </p>
              <div className="text-xs text-slate-600">
                vendorId / itemId / validFrom がキー（同一 validFrom は update 扱い）
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-slate-600 mb-1">品目ID</div>
                  <Input value={itemId} onChange={(e) => setItemId(e.target.value)} placeholder="001001" />
                  <div className="text-xs text-slate-600 mt-1">
                    {itemId ? `名称: ${itemNameMap.get(padItemId(itemId)) ?? ""}` : ""}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-600 mb-1">単価(円)</div>
                  <Input value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="例: 8919" />
                </div>
                <div>
                  <div className="text-xs text-slate-600 mb-1">有効開始</div>
                  <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
                </div>
                <div>
                  <div className="text-xs text-slate-600 mb-1">有効終了（空=NULL）</div>
                  <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button className="border rounded px-3 py-1 text-sm" onClick={resetForm}>
                  新規
                </button>
                <button className="border rounded px-3 py-1 text-sm bg-blue-600 text-white" onClick={onSave}>
                  保存
                </button>
              </div>
              {editId != null ? <div className="text-xs text-slate-600">編集中: id={editId}</div> : null}
            </CardContent>
          </Card>

          <Card className="shadow-none border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">一覧</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto border rounded">
                <table className="min-w-[720px] w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-3 py-2 w-16">id</th>
                      <th className="text-left px-3 py-2 w-24">品目</th>
                      <th className="text-left px-3 py-2">名称</th>
                      <th className="text-right px-3 py-2 w-24">単価</th>
                      <th className="text-left px-3 py-2 w-28">開始</th>
                      <th className="text-left px-3 py-2 w-28">終了</th>
                      <th className="px-3 py-2 w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        className="border-t cursor-pointer hover:bg-slate-50"
                        onClick={() => loadToForm(r)}
                        title="クリックで編集フォームに読み込み"
                      >
                        <td className="px-3 py-2">{r.id}</td>
                        <td className="px-3 py-2 font-mono">{r.itemId}</td>
                        <td className="px-3 py-2">{itemNameMap.get(r.itemId) ?? ""}</td>
                        <td className="px-3 py-2 text-right">{Number(r.unitPrice ?? 0).toLocaleString()}</td>
                        <td className="px-3 py-2 font-mono">{r.validFrom}</td>
                        <td className="px-3 py-2 font-mono">{r.validTo ?? ""}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="border rounded px-2 py-1 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              loadToForm(r);
                            }}
                          >
                            編集
                          </button>
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-3 text-slate-600">
                          該当なし
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  );
}
