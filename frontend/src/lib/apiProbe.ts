// frontend/src/lib/apiProbe.ts
import { Configuration, DefaultApi } from "../apiClient"; // ルートからの相対に注意

const cfg = new Configuration({ basePath: "http://localhost:8080" });
const api = new DefaultApi(cfg);

/** コンソールに結果を出すだけの簡易プローブ */
export async function probeApis() {
  const price = await api.resolvePricing({
    vendorId: "VND01",
    itemId: "ITM001",
    date: new Date("2025-10-10"),
    // storeId は任意
  });
  const rules = await api.resolveOrderingRules({
    vendorId: "VND01",
    storeId: "S001",
    date: new Date("2025-10-10"),
  });
  // 画面は汚さず、まずはコンソールで確認
  console.log("[pricing]", price);
  console.log("[rules]", rules);
}
