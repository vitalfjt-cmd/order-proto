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
