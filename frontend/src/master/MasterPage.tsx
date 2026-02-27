// frontend/src/master/MasterPage.tsx
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import VendorWeeklyRulesPanel from "./VendorWeeklyRulesPanel";
import StoreVendorOverridesPanel from "./StoreVendorOverridesPanel";
import ItemPricesPanel from "./ItemPricesPanel";
import ItemsPanel from "./ItemsPanel";
import VendorItemsPanel from "./VendorItemsPanel";
import StoreVendorItemsPanel from "./StoreVendorItemsPanel";
import VendorsPanel from "./VendorsPanel";
import StoresPanel from "./StoresPanel";

type MasterTab =
  | "vendors"
  | "stores"
  | "item-panels"
  | "vendor-items"
  | "store-vendor-items"
  | "vendor-rules"
  | "store-overrides"
  | "item-prices";

function parseTabFromHash(): MasterTab {
  const base = (location.hash.split("?")[0] || "").toLowerCase();

  if (base.includes("/master/vendors")) return "vendors";
  if (base.includes("/master/stores")) return "stores";
  if (base.includes("/master/item-panels")) return "item-panels";
  if (base.includes("/master/vendor-items")) return "vendor-items";
  if (base.includes("/master/store-vendor-items")) return "store-vendor-items";
  if (base.includes("/master/vendor-weekly-rules")) return "vendor-rules";
  if (base.includes("/master/store-overrides")) return "store-overrides";
  if (base.includes("/master/item-prices")) return "item-prices";

  return "vendors";
}

function setHash(tab: MasterTab) {
  if (tab === "vendors") location.hash = "#/master/vendors";
  if (tab === "stores") location.hash = "#/master/stores";
  if (tab === "item-panels") location.hash = "#/master/item-panels";
  if (tab === "vendor-items") location.hash = "#/master/vendor-items";
  if (tab === "store-vendor-items") location.hash = "#/master/store-vendor-items";
  if (tab === "vendor-rules") location.hash = "#/master/vendor-weekly-rules";
  if (tab === "store-overrides") location.hash = "#/master/store-overrides";
  if (tab === "item-prices") location.hash = "#/master/item-prices";
}

export default function MasterPage() {
  const [tab, setTab] = useState<MasterTab>(() => parseTabFromHash());

  useEffect(() => {
    const on = () => setTab(parseTabFromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const tabs = useMemo(
    () => [
      { key: "vendors" as const, label: "ベンダ" },
      { key: "stores" as const, label: "店舗" },
      { key: "item-panels" as const, label: "品目" },
      { key: "vendor-items" as const, label: "ベンダ取扱（期間）" },
      { key: "store-vendor-items" as const, label: "店舗×ベンダ取扱（期間）" },
      { key: "item-prices" as const, label: "単価（期間）" },
      { key: "vendor-rules" as const, label: "ベンダ週次ルール" },
      { key: "store-overrides" as const, label: "店舗×ベンダ上書き" },
    ],
    []
  );

  const title = useMemo(() => tabs.find((t) => t.key === tab)?.label ?? "マスタ", [tab, tabs]);

  const card = useMemo(() => {
    if (tab === "vendors") return <VendorsPanel />;
    if (tab === "stores") return <StoresPanel />;
    if (tab === "item-panels") return <ItemsPanel />;
    if (tab === "vendor-items") return <VendorItemsPanel />;
    if (tab === "store-vendor-items") return <StoreVendorItemsPanel />;
    if (tab === "item-prices") return <ItemPricesPanel />;
    if (tab === "vendor-rules") return <VendorWeeklyRulesPanel />;
    if (tab === "store-overrides") return <StoreVendorOverridesPanel />;
    return <VendorsPanel />;
  }, [tab]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`border rounded px-3 py-1 text-sm ${tab === t.key ? "bg-gray-100" : ""}`}
            onClick={() => setHash(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>{card}</CardContent>
      </Card>
    </div>
  );
}
