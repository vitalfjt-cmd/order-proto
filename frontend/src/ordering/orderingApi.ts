 import type {
   OrderListResponse,
   OrderDetail,
   OrderingEntryResponse,
   OrderingSubmitRequest,
   OrderingSubmitResponse,
 } from "./types";

 async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
   const r = await fetch(input, init);
   if (!r.ok) {
     const msg = await r.text().catch(() => "");
     throw new Error(msg || `HTTP ${r.status}`);
   }
   return (await r.json()) as T;
 }

 export const orderingApi = {
   entry: (storeId: string, orderDate: string) =>
     fetchJson<OrderingEntryResponse>(
       `/ordering/entry?storeId=${encodeURIComponent(storeId)}&orderDate=${encodeURIComponent(orderDate)}`
     ),

   submit: (dto: OrderingSubmitRequest) =>
     fetchJson<OrderingSubmitResponse>("/ordering/submit", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify(dto),
     }),

   // --- 互換: HistoryPage などで URLSearchParams を組み立てている場合用 ---
   listRaw: (q: URLSearchParams) =>
     fetchJson<OrderListResponse>(`/ordering/list?${q.toString()}`),
 
   // --- 便利: from/to のみで呼ぶ正規API（C着手後はこっちに寄せる） ---
   list: (params: { storeId: string; from: string; to: string }) => {
     const q = new URLSearchParams({ storeId: params.storeId, from: params.from, to: params.to });
     return fetchJson<OrderListResponse>(`/ordering/list?${q.toString()}`);
   },

   detail: (orderId: string) =>
     fetchJson<OrderDetail>(`/ordering/detail?orderId=${encodeURIComponent(orderId)}`),
     // ★ export_lines を JSON で受ける（backend が { items: [...] } を返している前提）
   exportLinesJson: (params: { storeId: string; from: string; to: string }) => {
     const q = new URLSearchParams({ storeId: params.storeId, from: params.from, to: params.to });
     return fetchJson<{ items?: unknown[] }>(`/ordering/export_lines?${q.toString()}`);
   },

   exportLinesRaw: async (q: URLSearchParams) => {
     const r = await fetch(`/ordering/export_lines?${q.toString()}`);
     if (!r.ok) throw new Error(await r.text().catch(() => ""));
     return await r.text(); // CSV text
   },
 
   exportLines: async (params: { storeId: string; from: string; to: string }) => {
     const q = new URLSearchParams({
       storeId: params.storeId,
       from: params.from,
       to: params.to,
     });
     const r = await fetch(`/ordering/export_lines?${q.toString()}`);
     if (!r.ok) throw new Error(await r.text().catch(() => ""));
     return await r.text(); // CSV を返す想定
   },
 };
