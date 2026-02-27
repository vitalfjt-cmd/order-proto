// frontend/src/master/StoreVendorOverridesPanel.tsx
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ApiHttpError,
  listStores,
  listVendors,
  listVendorWeeklyRules,
  listStoreVendorOverrides,
  padStoreId,
  padVendorId,
  upsertStoreVendorOverride,
  type StoreLite,
  type VendorLite,
  type VendorWeeklyRuleRow,
  type StoreVendorOverrideRow,
} from "./apiMaster";

type DayKey = "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat";
const DAYS: { key: DayKey; label: string }[] = [
  { key: "Sun", label: "日" },
  { key: "Mon", label: "月" },
  { key: "Tue", label: "火" },
  { key: "Wed", label: "水" },
  { key: "Thu", label: "木" },
  { key: "Fri", label: "金" },
  { key: "Sat", label: "土" },
];

type BaseDay = { orderable: 0 | 1; cutoff: string; lead: number };
type OverrideDay = { orderable: 0 | 1 | null; cutoff: string | null; lead: number | null };

function emptyOverrides(): Record<DayKey, OverrideDay> {
  const z: OverrideDay = { orderable: null, cutoff: null, lead: null };
  return { Sun: { ...z }, Mon: { ...z }, Tue: { ...z }, Wed: { ...z }, Thu: { ...z }, Fri: { ...z }, Sat: { ...z } };
}

function defaultBase(): Record<DayKey, BaseDay> {
  const b: BaseDay = { orderable: 0, cutoff: "04:00", lead: 1 };
  return { Sun: { ...b }, Mon: { ...b }, Tue: { ...b }, Wed: { ...b }, Thu: { ...b }, Fri: { ...b }, Sat: { ...b } };
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function baseFromVendorRule(vr: VendorWeeklyRuleRow | null): Record<DayKey, BaseDay> {
  if (!vr) return defaultBase();
  return {
    Sun: { orderable: vr.orderableSun, cutoff: vr.cutoffHhmmSun || "04:00", lead: Number(vr.leadTimeDaysSun ?? 1) },
    Mon: { orderable: vr.orderableMon, cutoff: vr.cutoffHhmmMon || "04:00", lead: Number(vr.leadTimeDaysMon ?? 1) },
    Tue: { orderable: vr.orderableTue, cutoff: vr.cutoffHhmmTue || "04:00", lead: Number(vr.leadTimeDaysTue ?? 1) },
    Wed: { orderable: vr.orderableWed, cutoff: vr.cutoffHhmmWed || "04:00", lead: Number(vr.leadTimeDaysWed ?? 1) },
    Thu: { orderable: vr.orderableThu, cutoff: vr.cutoffHhmmThu || "04:00", lead: Number(vr.leadTimeDaysThu ?? 1) },
    Fri: { orderable: vr.orderableFri, cutoff: vr.cutoffHhmmFri || "04:00", lead: Number(vr.leadTimeDaysFri ?? 1) },
    Sat: { orderable: vr.orderableSat, cutoff: vr.cutoffHhmmSat || "04:00", lead: Number(vr.leadTimeDaysSat ?? 1) },
  };
}

function overridesFromRow(row: StoreVendorOverrideRow | null): Record<DayKey, OverrideDay> {
  if (!row) return emptyOverrides();
  return {
    Sun: { orderable: row.orderableSunOverride, cutoff: row.cutoffHhmmSunOverride, lead: row.leadTimeDaysSunOverride },
    Mon: { orderable: row.orderableMonOverride, cutoff: row.cutoffHhmmMonOverride, lead: row.leadTimeDaysMonOverride },
    Tue: { orderable: row.orderableTueOverride, cutoff: row.cutoffHhmmTueOverride, lead: row.leadTimeDaysTueOverride },
    Wed: { orderable: row.orderableWedOverride, cutoff: row.cutoffHhmmWedOverride, lead: row.leadTimeDaysWedOverride },
    Thu: { orderable: row.orderableThuOverride, cutoff: row.cutoffHhmmThuOverride, lead: row.leadTimeDaysThuOverride },
    Fri: { orderable: row.orderableFriOverride, cutoff: row.cutoffHhmmFriOverride, lead: row.leadTimeDaysFriOverride },
    Sat: { orderable: row.orderableSatOverride, cutoff: row.cutoffHhmmSatOverride, lead: row.leadTimeDaysSatOverride },
  };
}

export default function StoreVendorOverridesPanel() {
  const [stores, setStores] = useState<StoreLite[]>([]);
  const [vendors, setVendors] = useState<VendorLite[]>([]);
  const [storeId, setStoreId] = useState<string>("");
  const [vendorId, setVendorId] = useState<string>("");

  const [base, setBase] = useState<Record<DayKey, BaseDay>>(defaultBase());
  const [ovr, setOvr] = useState<Record<DayKey, OverrideDay>>(emptyOverrides());
  const [loading, setLoading] = useState(false);

  const storeName = useMemo(() => stores.find((s) => s.id === padStoreId(storeId))?.name ?? "", [stores, storeId]);
  const vendorName = useMemo(() => vendors.find((v) => v.id === padVendorId(vendorId))?.name ?? "", [vendors, vendorId]);

  useEffect(() => {
    void (async () => {
      const [ss, vs] = await Promise.all([listStores(), listVendors()]);
      setStores(ss);
      setVendors(vs);
      if (ss[0]?.id) setStoreId(ss[0].id);
      if (vs[0]?.id) setVendorId(vs[0].id);
    })();
  }, []);

  useEffect(() => {
    if (!storeId || !vendorId) return;
    void (async () => {
      setLoading(true);
      try {
        const sid = padStoreId(storeId);
        const vid = padVendorId(vendorId);

        const vr = (await listVendorWeeklyRules(vid))[0] ?? null;
        setBase(baseFromVendorRule(vr));

        const row = (await listStoreVendorOverrides({ storeId: sid, vendorId: vid }))[0] ?? null;
        setOvr(overridesFromRow(row));
      } finally {
        setLoading(false);
      }
    })();
  }, [storeId, vendorId]);

  async function onSave() {
    if (!storeId || !vendorId) return;
    const sid = padStoreId(storeId);
    const vid = padVendorId(vendorId);

    const payload: Partial<StoreVendorOverrideRow> & { storeId: string; vendorId: string } = {
      storeId: sid,
      vendorId: vid,

      orderableSunOverride: ovr.Sun.orderable,
      cutoffHhmmSunOverride: ovr.Sun.cutoff,
      leadTimeDaysSunOverride: ovr.Sun.lead,

      orderableMonOverride: ovr.Mon.orderable,
      cutoffHhmmMonOverride: ovr.Mon.cutoff,
      leadTimeDaysMonOverride: ovr.Mon.lead,

      orderableTueOverride: ovr.Tue.orderable,
      cutoffHhmmTueOverride: ovr.Tue.cutoff,
      leadTimeDaysTueOverride: ovr.Tue.lead,

      orderableWedOverride: ovr.Wed.orderable,
      cutoffHhmmWedOverride: ovr.Wed.cutoff,
      leadTimeDaysWedOverride: ovr.Wed.lead,

      orderableThuOverride: ovr.Thu.orderable,
      cutoffHhmmThuOverride: ovr.Thu.cutoff,
      leadTimeDaysThuOverride: ovr.Thu.lead,

      orderableFriOverride: ovr.Fri.orderable,
      cutoffHhmmFriOverride: ovr.Fri.cutoff,
      leadTimeDaysFriOverride: ovr.Fri.lead,

      orderableSatOverride: ovr.Sat.orderable,
      cutoffHhmmSatOverride: ovr.Sat.cutoff,
      leadTimeDaysSatOverride: ovr.Sat.lead,
    };

    try {
      await upsertStoreVendorOverride(payload);
      alert("保存しました。");
    } catch (e: unknown) {
      if (e instanceof ApiHttpError) {
        alert(`保存に失敗しました: ${e.status} ${e.statusText}\n${JSON.stringify(e.body)}`);
        return;
      }
      alert(`保存に失敗しました: ${errText(e)}`);
    }
  }

  function onDownloadCsv() {
  const qs = new URLSearchParams();
  if (storeId) qs.set("storeId", padStoreId(storeId));
  if (vendorId) qs.set("vendorId", padVendorId(vendorId));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  window.open(`/master/store-vendor-overrides.csv${suffix}`, "_blank");
}

  function clearAll() {
    setOvr(emptyOverrides());
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">店舗×ベンダー 上書き</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs text-slate-600 mb-1">店舗</div>
            <select className="border rounded px-2 py-1 text-sm" value={padStoreId(storeId)} onChange={(e) => setStoreId(e.target.value)}>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id} {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs text-slate-600 mb-1">ベンダー</div>
            <select className="border rounded px-2 py-1 text-sm" value={padVendorId(vendorId)} onChange={(e) => setVendorId(e.target.value)}>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id} {v.name}
                </option>
              ))}
            </select>
          </div>

          <div className="text-sm text-slate-700">
            <span className="font-mono">{padStoreId(storeId)}</span> {storeName} /{" "}
            <span className="font-mono">{padVendorId(vendorId)}</span> {vendorName}
          </div>

          <div className="ml-auto flex gap-2">
            <button className="border rounded px-3 py-1 text-sm" onClick={clearAll} disabled={loading}>
              全クリア
            </button>
            <button
              className="border rounded px-3 py-1 text-sm bg-blue-600 text-white disabled:opacity-60"
              onClick={onSave}
              disabled={loading || !storeId || !vendorId}
            >
              保存
            </button>
            <button
              type="button"
              className="border rounded px-3 py-1"
              onClick={onDownloadCsv}
            >
              CSV
            </button>
          </div>
        </div>

        <div className="overflow-auto border rounded">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2 w-20">曜日</th>
                <th className="text-left px-3 py-2 w-36">基準：発注可</th>
                <th className="text-left px-3 py-2 w-36">上書き：発注可</th>
                <th className="text-left px-3 py-2 w-40">基準：締め</th>
                <th className="text-left px-3 py-2 w-40">上書き：締め</th>
                <th className="text-left px-3 py-2 w-28">基準：LT</th>
                <th className="text-left px-3 py-2 w-28">上書き：LT</th>
              </tr>
            </thead>
            <tbody>
              {DAYS.map((d) => {
                const b = base[d.key];
                const o = ovr[d.key];
                const hasAny = o.orderable !== null || o.cutoff !== null || o.lead !== null;
                return (
                  <tr key={d.key} className={`border-t ${hasAny ? "bg-amber-50/40" : ""}`}>
                    <td className="px-3 py-2">{d.label}</td>

                    <td className="px-3 py-2">{b.orderable === 1 ? "可" : "不可"}</td>
                    <td className="px-3 py-2">
                      <select
                        className="border rounded px-2 py-1 text-sm"
                        value={o.orderable === null ? "" : String(o.orderable)}
                        onChange={(e) => {
                          const v = e.target.value;
                          setOvr((prev) => ({
                            ...prev,
                            [d.key]: { ...prev[d.key], orderable: v === "" ? null : (Number(v) as 0 | 1) },
                          }));
                        }}
                      >
                        <option value="">未設定</option>
                        <option value="1">可</option>
                        <option value="0">不可</option>
                      </select>
                    </td>

                    <td className="px-3 py-2">{b.cutoff}</td>
                    <td className="px-3 py-2">
                      <Input
                        type="time"
                        value={o.cutoff ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setOvr((prev) => ({
                            ...prev,
                            [d.key]: { ...prev[d.key], cutoff: v === "" ? null : v },
                          }));
                        }}
                        className="w-40"
                      />
                    </td>

                    <td className="px-3 py-2">{b.lead}</td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={o.lead ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setOvr((prev) => ({
                            ...prev,
                            [d.key]: { ...prev[d.key], lead: v === "" ? null : Number(v) },
                          }));
                        }}
                        className="w-28"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-slate-600">
          ※ 上書きは「未設定（NULL）」なら基準（ベンダー週次ルール）を採用します。上書きが入っている行は薄い色で表示します。
        </div>
      </CardContent>
    </Card>
  );
}
