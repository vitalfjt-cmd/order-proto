// frontend/src/store/storeStocksApi.ts
export type StoreStockRow = {
  storeId: string;
  itemId: string;
  qty: number;
};

export type StoreStockSearchResult = {
  ok: boolean;
  storeId: string;
  asOf: string;
  rows: StoreStockRow[];
  error?: string;
};

export async function searchStoreStocks(params: {
  storeId: string;
  asOf?: string;
}): Promise<StoreStockSearchResult> {
  const usp = new URLSearchParams();
  usp.set("storeId", params.storeId);
  if (params.asOf) {
    usp.set("asOf", params.asOf);
  }

  const res = await fetch(`/stocks/store-stocks?${usp.toString()}`);
  if (!res.ok) {
    return {
      ok: false,
      storeId: params.storeId,
      asOf: params.asOf ?? "",
      rows: [],
      error: `HTTP ${res.status}`,
    };
  }

  const json = await res.json();
  return {
    ok: !!json.ok,
    storeId: json.storeId,
    asOf: json.asOf,
    rows: json.rows ?? [],
    error: json.error,
  };
}

export type ValuationMethod = "TOTAL_AVG" | "MOVING_AVG";

export async function getValuationSettings(storeId: string): Promise<{ storeId: string; method: ValuationMethod }> {
  const r = await fetch(`/stocks/valuation-settings?storeId=${encodeURIComponent(storeId)}`);
  if (!r.ok) throw new Error("failed to get valuation settings");
  return await r.json();
}

export async function setValuationSettings(storeId: string, method: ValuationMethod): Promise<void> {
  const r = await fetch(`/stocks/valuation-settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storeId, method }),
  });
  if (!r.ok) throw new Error("failed to set valuation settings");
}
