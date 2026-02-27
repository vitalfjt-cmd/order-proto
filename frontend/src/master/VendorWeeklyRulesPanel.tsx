// frontend/src/master/VendorWeeklyRulesPanel.tsx
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ApiHttpError,
  listVendors,
  listVendorWeeklyRules,
  padVendorId,
  upsertVendorWeeklyRule,
  type VendorLite,
  type VendorWeeklyRuleRow,
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

type DayRule = { orderable: boolean; cutoff: string; lead: number };

function defaultRules(): Record<DayKey, DayRule> {
  const base: DayRule = { orderable: false, cutoff: "04:00", lead: 1 };
  return {
    Sun: { ...base },
    Mon: { ...base },
    Tue: { ...base },
    Wed: { ...base },
    Thu: { ...base },
    Fri: { ...base },
    Sat: { ...base },
  };
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function fromRow(row: VendorWeeklyRuleRow): Record<DayKey, DayRule> {
  return {
    Sun: { orderable: row.orderableSun === 1, cutoff: row.cutoffHhmmSun || "04:00", lead: Number(row.leadTimeDaysSun ?? 1) },
    Mon: { orderable: row.orderableMon === 1, cutoff: row.cutoffHhmmMon || "04:00", lead: Number(row.leadTimeDaysMon ?? 1) },
    Tue: { orderable: row.orderableTue === 1, cutoff: row.cutoffHhmmTue || "04:00", lead: Number(row.leadTimeDaysTue ?? 1) },
    Wed: { orderable: row.orderableWed === 1, cutoff: row.cutoffHhmmWed || "04:00", lead: Number(row.leadTimeDaysWed ?? 1) },
    Thu: { orderable: row.orderableThu === 1, cutoff: row.cutoffHhmmThu || "04:00", lead: Number(row.leadTimeDaysThu ?? 1) },
    Fri: { orderable: row.orderableFri === 1, cutoff: row.cutoffHhmmFri || "04:00", lead: Number(row.leadTimeDaysFri ?? 1) },
    Sat: { orderable: row.orderableSat === 1, cutoff: row.cutoffHhmmSat || "04:00", lead: Number(row.leadTimeDaysSat ?? 1) },
  };
}

export default function VendorWeeklyRulesPanel() {
  const [vendors, setVendors] = useState<VendorLite[]>([]);
  const [vendorId, setVendorId] = useState<string>("");
  const [rules, setRules] = useState<Record<DayKey, DayRule>>(defaultRules());
  const [loading, setLoading] = useState(false);

  const vendorName = useMemo(() => {
    const vid = padVendorId(vendorId);
    return vendors.find((v) => v.id === vid)?.name ?? "";
  }, [vendors, vendorId]);

  useEffect(() => {
    void (async () => {
      const vs = await listVendors();
      setVendors(vs);
      const first = vs[0]?.id ?? "";
      if (first) setVendorId(first);
    })();
  }, []);

  useEffect(() => {
    if (!vendorId) return;
    void (async () => {
      setLoading(true);
      try {
        const vid = padVendorId(vendorId);
        const rows = await listVendorWeeklyRules(vid);
        const row = rows[0];
        setRules(row ? fromRow(row) : defaultRules());
      } finally {
        setLoading(false);
      }
    })();
  }, [vendorId]);

  async function onSave() {
    if (!vendorId) return;
    const vid = padVendorId(vendorId);

    const payload: Partial<VendorWeeklyRuleRow> & { vendorId: string } = {
      vendorId: vid,

      orderableSun: rules.Sun.orderable ? 1 : 0,
      cutoffHhmmSun: rules.Sun.cutoff,
      leadTimeDaysSun: rules.Sun.lead,

      orderableMon: rules.Mon.orderable ? 1 : 0,
      cutoffHhmmMon: rules.Mon.cutoff,
      leadTimeDaysMon: rules.Mon.lead,

      orderableTue: rules.Tue.orderable ? 1 : 0,
      cutoffHhmmTue: rules.Tue.cutoff,
      leadTimeDaysTue: rules.Tue.lead,

      orderableWed: rules.Wed.orderable ? 1 : 0,
      cutoffHhmmWed: rules.Wed.cutoff,
      leadTimeDaysWed: rules.Wed.lead,

      orderableThu: rules.Thu.orderable ? 1 : 0,
      cutoffHhmmThu: rules.Thu.cutoff,
      leadTimeDaysThu: rules.Thu.lead,

      orderableFri: rules.Fri.orderable ? 1 : 0,
      cutoffHhmmFri: rules.Fri.cutoff,
      leadTimeDaysFri: rules.Fri.lead,

      orderableSat: rules.Sat.orderable ? 1 : 0,
      cutoffHhmmSat: rules.Sat.cutoff,
      leadTimeDaysSat: rules.Sat.lead,
    };

    try {
      await upsertVendorWeeklyRule(payload);
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
    const vid = vendorId ? padVendorId(vendorId) : "";
    const qs = vid ? `?vendorId=${encodeURIComponent(vid)}` : "";
    // DL（別タブでOK。同タブにしたいなら window.location.href にする）
    window.open(`/master/vendor-weekly-rules.csv${qs}`, "_blank");
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">ベンダー週次ルール</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
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

          <div className="text-sm text-slate-700">{vendorName ? <span className="font-medium">{vendorName}</span> : null}</div>

          <button
            className="ml-auto border rounded px-3 py-1 text-sm bg-blue-600 text-white disabled:opacity-60"
            disabled={loading || !vendorId}
            onClick={onSave}
          >
            保存
          </button>
          <button
            type="button"
            className="border rounded px-3 py-1"
            onClick={onDownloadCsv}
            disabled={!vendorId}
          >
            CSV
          </button>
        </div>

        <div className="overflow-auto border rounded">
          <table className="min-w-[780px] w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2 w-20">曜日</th>
                <th className="text-left px-3 py-2 w-28">発注可</th>
                <th className="text-left px-3 py-2 w-40">締め(HH:MM)</th>
                <th className="text-left px-3 py-2 w-40">LT(日)</th>
              </tr>
            </thead>
            <tbody>
              {DAYS.map((d) => (
                <tr key={d.key} className="border-t">
                  <td className="px-3 py-2">{d.label}</td>
                  <td className="px-3 py-2">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={rules[d.key].orderable}
                        onChange={(e) =>
                          setRules((prev) => ({
                            ...prev,
                            [d.key]: { ...prev[d.key], orderable: e.target.checked },
                          }))
                        }
                      />
                      <span className="text-sm">{rules[d.key].orderable ? "可" : "不可"}</span>
                    </label>
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="time"
                      value={rules[d.key].cutoff}
                      onChange={(e) =>
                        setRules((prev) => ({
                          ...prev,
                          [d.key]: { ...prev[d.key], cutoff: e.target.value },
                        }))
                      }
                      className="w-40"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={rules[d.key].lead}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        setRules((prev) => ({
                          ...prev,
                          [d.key]: { ...prev[d.key], lead: Number.isFinite(n) ? n : 0 },
                        }));
                      }}
                      className="w-32"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-slate-600">
          ※ ここは「ベンダーの基準ルール」です。店舗別に変える場合は「店舗×ベンダー上書き」を使います。
        </div>
      </CardContent>
    </Card>
  );
}
