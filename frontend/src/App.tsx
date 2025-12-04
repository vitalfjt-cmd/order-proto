import React, { useEffect, useMemo, useState, Suspense } from "react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ListOrdered, Truck, ClipboardCheck, History, Menu, Home  } from "lucide-react";
import { motion } from "framer-motion";
import { loadLatestDraftLike } from "./db";
import { toCsvString, downloadCsv } from "./utils/csv";
import { VendorInspectionList } from "./vendor/VendorInspectionList";



// 遅延ロード（必要時のみ読み込み）
const VendorShipments = React.lazy(() =>
  import("./vendor/VendorShipments").then(m => ({ default: m.VendorShipments }))
);
const VendorEdit = React.lazy(() =>
  import("./vendor/VendorEdit").then(m => ({ default: m.VendorEdit }))
);
// const VendorInspectionList = React.lazy(() =>
//   import("./inspection/VendorInspectionList").then(m => ({ default: m.VendorInspectionList }))
// );
const HistoryPage = React.lazy(() => import("./HistoryPage"));
// ★ ここを追加
const AuditView = React.lazy(() => import("./audit/AuditView"));

// 店舗向け検品（/frontend/src/inspection 配下）
const StoreInspectionList = React.lazy(() =>
  import("./inspection/InspectionList").then(m => ({ default: m.InspectionList }))
);
const StoreInspectionEdit = React.lazy(() =>
  import("./inspection/InspectionEdit").then(m => ({ default: m.InspectionEdit }))
);

// =========================
//  OrderEntry（既存の発注画面）
//  ※ もとの App.tsx のコンポーネントをそのまま内包
// =========================

// const api = new DefaultApi(new Configuration({ basePath: "" }));

// 保存読み戻し時に lineId を付与する簡易ヘルパー
// const genLineId = (itemId: string, i: number) =>
//   `ln-${itemId}-${i}-${Date.now()}`;

const IS_MANAGER = false; // true にすると起動時に自動呼出ししない

// --- Types ---

type StoreLite = { id: string; name: string };

type VendorLite = { id: string; name: string; cutoffHHmm?: string; leadTimeDays?: number };


// サーバー側が返す行の型バリエーションを吸収するためのユニオン
type RawLine =
  | {
      itemId: string;
      qty?: number;
      unitPrice?: number;
      vendorId?: string;
      expectedArrivalDate?: string | null;
    }
  | {
      item_id: string;
      qty?: number;
      unit_price?: number;
      vendor_id?: string;
      expected_arrival_date?: string | null;
    };

    type ApiItem = {
      itemId: string;
      name: string;
      spec: string;
      unit: string;
      vendorId: string;
      unitPrice: number;
    };
    
    function normalizeRawLine(ln: RawLine): {
      itemId: string;
      qty: number;
      unitPrice: number;
      vendorId: string;
      expectedArrivalDate: string | null;
    } {
      if ("itemId" in ln) {
        // camelCase パターン
        return {
          itemId: ln.itemId ?? "",
          qty: Number(ln.qty ?? 0),
          unitPrice: Number(ln.unitPrice ?? 0),
          vendorId: String(ln.vendorId ?? ""),
          expectedArrivalDate: ln.expectedArrivalDate ?? null,
        };
      } else {
        // snake_case パターン
        return {
          itemId: ln.item_id ?? "",
          qty: Number(ln.qty ?? 0),
          unitPrice: Number(ln.unit_price ?? 0),
          vendorId: String(ln.vendor_id ?? ""),
          expectedArrivalDate: ln.expected_arrival_date ?? null,
        };
      }
    }

type OrderLine = {
  lineId: string;           // UI用ユニーク
  itemId: string;
  qty: number;
  unitPrice: number;
  vendorId: string;
  expectedArrivalDate: string | null;
};

type OrderDraft = {
  storeId: string;
  vendorMode: "all";
  vendorId: null;
  requestDate: string;            // 日付(YYYY-MM-DD)
  expectedArrivalDate: string | null;
  taxRate: number;
  lines: OrderLine[];
  status: "draft" | "confirmed";  // フロント内での扱い用
};

// --- Utilities ---
const formatDateLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function getBusinessDate(now = new Date()) {
  const h = now.getHours(), m = now.getMinutes();
  const isMaintenance = (h === 4) || (h === 5 && m === 0); // 04:00台をメンテ（厳密には04:00〜04:59想定）
  // 04:00までは前日扱い（04:01から当日）
  const ref = new Date(now);
  if (h < 4 || (h === 4 && m === 0)) ref.setDate(ref.getDate() - 1);
  return { businessDate: formatDateLocal(ref), isMaintenance };
}

// 営業日付の "今日" を常に取りたいとき用
function getTodayBusinessYmd(): string {
  return getBusinessDate().businessDate;
}

// --- pricing resolve (cache) ---


function getCutoffAt(orderDate: string, hhmm: string): Date {
  const [hh, mm] = hhmm.split(":").map(Number);
  const d = new Date(orderDate + "T00:00:00"); // 営業日付の0時
  d.setDate(d.getDate() + 1); // 翌日に進める
  d.setHours(hh, mm, 0, 0); // 04:00 など
  return d; // ローカルタイム（ブラウザ）
}
function isFutureBusinessDate(orderDate: string): boolean {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;
  return orderDate > todayStr; // 未来の営業日付なら true
}

const DEBUG_SAME_DAY_CUTOFF = false;

function isPastCutoff(orderDate: string, hhmm: string) {
  if (!orderDate) return false;
  if (isFutureBusinessDate(orderDate)) return false; // 未来日は常に編集OK
  if (DEBUG_SAME_DAY_CUTOFF) {
    const [hh, mm] = hhmm.split(":").map(Number);
    const t = new Date(orderDate + "T00:00:00");
    t.setHours(hh, mm, 0, 0);
    return Date.now() > t.getTime();
  }
  const cutoff = getCutoffAt(orderDate, hhmm);
  return Date.now() > cutoff.getTime();
}

export type SubmitLine = {
  itemId: string;
  qty: number;
  unitPrice: number;
  vendorId: string;
  expectedArrivalDate?: string | null;
};
export type SubmitDto = {
  storeId: string;
  vendorMode: "all";
  vendorId: null;
  orderDate: string;
  expectedArrivalDate?: string | null;
  taxRate: number;
  lines: SubmitLine[];
};

// --- Main Component: Order Entry ---
function OrderEntryPrototype() {
  const biz = getBusinessDate();
  // --- 発注ヘッダ＋明細のメイン状態 ---
  const [draft, setDraft] = useState<OrderDraft>(() => ({
    storeId: "0002",               // 既定の店舗。あなたの運用に合わせてOK
    vendorMode: "all",             // B案運用：常に all で送信
    vendorId: null,                // all のときは常に null
    requestDate: biz.businessDate, // 今日の営業日付
    expectedArrivalDate: null,     // 行ごとに計算できるのでヘッダ側は null でいい
    taxRate: 0.1,
    lines: [],                     // 検索前は空
    status: "draft",
  }));

  // 過去日/締切後ロック（アラートは1回だけ、以後はロック＋案内）
  // 2. 画面ロック・バナー関連
  const [isPastLocked, setIsPastLocked] = useState<boolean>(false);
  // 3. マスタ類
  const [stores, setStores] = useState<StoreLite[]>([]);
    // 3. マスタ類 の直後あたりに追加
  const [serverStoreName, setServerStoreName] = useState<string>("");
  const [serverVendorNames, setServerVendorNames] = useState<Record<string,string>>({});
  const [serverItemNames, setServerItemNames] = useState<Record<string,string>>({});
  const [vendors, setVendors] = useState<VendorLite[]>([]);
  // 表示だけ絞るためのベンダーID
  const [filterVendorId, setFilterVendorId] = useState<string | null>(null);
  // 締め時間のモード: 'perVendor'（従来） or 'fixed'（固定）
  const [cutoffMode, setCutoffMode] = useState<'perVendor' | 'fixed'>('perVendor');
  const [fixedCutoff, setFixedCutoff] = useState<string | null>(null);
  const [availableCutoffs, setAvailableCutoffs] = useState<string[]>([]);
  const [statusReason, setStatusReason] = useState<string>(""); 
  // ベンダーごとのルール {vendorId: {orderable, cutoffHHmm, leadTimeDays}}
  const [vendorRules, setVendorRules] = useState<Record<string, {
    orderable: boolean; cutoffHHmm: string; leadTimeDays: number;
  }>>({});
  // 既存の state 群の近くに追記
  const [storeIdInput, setStoreIdInput] = useState<string>(draft.storeId ?? "");
  const [storeNameLabel, setStoreNameLabel] = useState<string>("");
  const [storeModalOpen, setStoreModalOpen] = useState(false);

  // 店舗IDを 4桁ゼロパディング（数字のみ抽出）
  function normalizeStoreId(raw: string): string {
    const digits = String(raw || "").replace(/\D/g, "");
    return digits ? digits.padStart(4, "0") : "";
  }

  // ID → 店舗名を返す
  function getStoreNameById(id: string): string {
    const hit = stores.find(s => s.id === id);
    return hit ? hit.name : "";
  }

  // stores or draft.storeId が変わったら、ラベル/入力を同期
  useEffect(() => {
    const id = draft.storeId ?? "";
    setStoreIdInput(id);
    setStoreNameLabel(getStoreNameById(id));
  }, [draft.storeId, stores]);

  // 表示用の受注可否・締め・LT：filterVendorId から派生
  const orderRule = React.useMemo(() => {
      if (!filterVendorId) return null;
      const r = vendorRules[filterVendorId];
      return r ? { orderable: r.orderable, cutoffHHmm: r.cutoffHHmm, leadTimeDays: r.leadTimeDays } : null;
    }, [filterVendorId, vendorRules]);

  // 表示用の行マスタ
  const [itemsMap, setItemsMap] = useState<Record<
    string,
    { name: string; spec: string; unit: string; vendorId: string; unitPrice: number }
  >>({});
  // 画面で使う締め時刻（API優先 / なければ 04:00）
  const cutoffFromRule = orderRule?.cutoffHHmm ?? "04:00";
  const [isSearchLocked, setIsSearchLocked] = useState(false);

  const isLinesLocked = (() => {
    if (isFutureBusinessDate(draft.requestDate)) return false;
     // ベンダー自体が「本日発注不可」の場合はロック
    if (orderRule && !orderRule.orderable) return true;
     // サーバー側でもう confirmed 扱いならロック
    if (draft.status === "confirmed") return true;
    return isPastCutoff(draft.requestDate, cutoffFromRule);
  })();

  // 送信可否
  const canSubmit = draft.lines.length > 0 && draft.lines.some(l => (l.qty ?? 0) > 0);

  // 店舗マスタ
  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch("/stores");
        const json = (await resp.json()) as { stores: StoreLite[] };
        setStores(json.stores);

        setDraft(prev => {
          if (!prev.storeId && json.stores.length > 0) {
            return { ...prev, storeId: json.stores[0].id };
          }
          return prev;
        });
      } catch (e) {
        console.error("[stores] fetch failed", e);
      }
    })();
  }, []);

  // ベンダーマスタ
  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch("/vendors");
        const json = (await resp.json()) as { vendors: VendorLite[] };
        setVendors(json.vendors);

        setDraft(prev => {
          // B案運用ではヘッダ側 vendorId は常に null 固定なので、
          // vendorId を勝手に入れないようにする。
          return prev;
        });
      } catch (e) {
        console.error("[vendors] fetch failed", e);
      }
    })();
  }, []);

  // 締め固定で表示対象にするベンダID集合（Set）
  const vendorIdsForFixed = React.useMemo<Set<string> | null>(() => {
    if (cutoffMode !== "fixed" || !fixedCutoff) return null;
    const ids = Object.entries(vendorRules)
      .filter(([, r]) => r.orderable && r.cutoffHHmm === fixedCutoff)
      .map(([v]) => v);
    return ids.length ? new Set(ids) : null;
  }, [cutoffMode, fixedCutoff, vendorRules]);

  const isLocked =
    draft.status === "confirmed" ||
    (orderRule && !orderRule.orderable) ||
    isPastCutoff(draft.requestDate, cutoffFromRule);

  useEffect(() => {
    if (cutoffMode === "fixed" && !fixedCutoff && availableCutoffs.length > 0) {
      setFixedCutoff(availableCutoffs[0]);
    }
  }, [cutoffMode, fixedCutoff, availableCutoffs]);


  // 起動時：通常ユーザーは自動呼出し、管理者はしない
  useEffect(() => {
    if (IS_MANAGER) return;
    // void doSearch(false);
    void doSearch();
  }, []);

  const searchingRef = React.useRef(false);

  async function doSearch() {
    if (searchingRef.current) return;
    searchingRef.current = true;

    try {
      const storeId = draft.storeId;
      const orderDate = draft.requestDate;

      const resp = await fetch(
        `/ordering/entry?storeId=${encodeURIComponent(storeId)}&orderDate=${encodeURIComponent(orderDate)}`
      );

      if (!resp.ok) {
        console.error("entry fetch failed", await resp.text());
        alert("検索に失敗しました");
        return;
      }

      const data = await resp.json();

      // 名称マップ（サーバがあれば優先）
      setServerStoreName(String(data.storeName ?? getStoreNameById(draft.storeId)));
      setServerVendorNames((data.vendorNames ?? {}) as Record<string,string>);
      setServerItemNames((data.itemNames ?? {}) as Record<string,string>);

      // 店舗マスタ（必要なら更新）
      setStores(Array.isArray(data.stores) ? data.stores : []);

      // ベンダーマスタ
      // 例: [{id:"600502",name:"酒販ベンダーA"}, ...]
      setVendors(Array.isArray(data.vendors) ? data.vendors : []);

      // ルール（ベンダー別）
      const perVendor: Record<string,{orderable:boolean;cutoffHHmm:string;leadTimeDays:number}> =
        data.rules?.perVendor ?? {};
      setVendorRules(perVendor);

      // 締め候補一覧（固定モードのプルダウンで使う）
      {
        const setCut = new Set<string>();
        Object.values(perVendor).forEach(r => {
          if (r && r.cutoffHHmm) setCut.add(r.cutoffHHmm);
        });
        const list = [...setCut].sort();
        setAvailableCutoffs(list);
        setFixedCutoff(prev => (prev && list.includes(prev) ? prev : (list[0] ?? null)));
      }

      // === ロック/バナー状態の最終決定 ===
      // 1) 「過去日」は常に非編集（サーバ事情に依らずフロントで強制）
      // 2) それ以外はサーバの editable を尊重（無ければ true 扱い）
      const todayYmd = getTodayBusinessYmd(); // 例: "2025-11-04"
      const isPastDate = (orderDate < todayYmd);
      const srvEditable = data?.status?.editable !== false; // undefined なら true
      const srvReason = String(data?.status?.reason ?? "");
      const uiEditable = isPastDate ? false : srvEditable;
      const uiReason = isPastDate
        ? "締切後のデータは変更できません。履歴画面でご確認ください。"
        : srvReason;

      setIsPastLocked(!uiEditable);
      setStatusReason(uiReason);

      // data.items は [{ itemId, name, spec, unit, vendorId, unitPrice }, ...]
      const map: Record<string,{name:string;spec:string;unit:string;vendorId:string;unitPrice:number}> = {};
      for (const it of (data.items ?? [])) {
        if (!it || !it.itemId) continue;
        map[it.itemId] = {
          name: it.name ?? "",
          spec: it.spec ?? "",
          unit: it.unit ?? "",
          vendorId: it.vendorId ?? "",
          unitPrice: Number(it.unitPrice ?? 0),
        };
      }
      setItemsMap(map);

      // 行データ
      // サーバーが mergedLines を返す想定ならそれを優先、
      // 無ければ draft.lines / order.lines / items 初期化の順で拾う
      let baseLines: Array<{
        itemId: string;
        qty: number;
        unitPrice: number;
        vendorId?: string;
        expectedArrivalDate?: string | null;
      }> = [];

      if (Array.isArray(data.mergedLines)) {
        baseLines = data.mergedLines.map((ln: RawLine) => normalizeRawLine(ln));
      } else if (data.draft?.exists && Array.isArray(data.draft.lines)) {
        baseLines = data.draft.lines.map((ln: RawLine) => normalizeRawLine(ln));
      } else if (data.order?.exists && Array.isArray(data.order.lines)) {
        baseLines = data.order.lines.map((ln: RawLine) => normalizeRawLine(ln));
      } else if (Array.isArray(data.items)) {
          baseLines = (data.items as ApiItem[]).map((it) => ({
          itemId: it.itemId,
          qty: 0,
          unitPrice: Number(it.unitPrice ?? 0),
          vendorId: it.vendorId ?? "",
          expectedArrivalDate: null,
        }));
      }

      // UI用 lineId を付与
      const uiLines: OrderLine[] = baseLines.map((ln, idx) => ({
        lineId: `ln-${ln.itemId}-${idx}`,
        itemId: ln.itemId,
        qty: Number.isFinite(ln.qty) ? ln.qty : 0,
        unitPrice: Number.isFinite(ln.unitPrice) ? ln.unitPrice : (map[ln.itemId]?.unitPrice ?? 0),
        vendorId: ln.vendorId || (map[ln.itemId]?.vendorId ?? ""),
        expectedArrivalDate: ln.expectedArrivalDate ?? null,
      }));

      // draft 更新
      setDraft(prev => ({
        ...prev,
        // storeId / requestDate はそのまま維持
        vendorMode: "all",          // B案：ヘッダは常に all
        vendorId: null,
        lines: uiLines,
        status: uiEditable ? "draft" : "confirmed",
        expectedArrivalDate: null,  // 行ごとにあるのでヘッダ側は null
      }));

      // いま選んでいる filterVendorId が、まだ存在するベンダーか確認。
      setFilterVendorId(prevFilter => {
        if (!prevFilter) return null;
        const stillExists = (data.vendors as VendorLite[] ?? []).some((v) => v.id === prevFilter);
        return stillExists ? prevFilter : null;
      });

    } finally {
      searchingRef.current = false;
    }
  }
  function handleClearSearch() {
    setIsPastLocked(false);
    setIsSearchLocked(false);
    searchingRef.current = false;

    setVendorRules({});
    setAvailableCutoffs([]);
    setCutoffMode("perVendor");
    setFixedCutoff(null);
    setFilterVendorId(null);
    setItemsMap({});

    const today = getTodayBusinessYmd();

    setDraft(prev => ({
      ...prev,
      vendorMode: "all",            // 'all'固定
      vendorId: null,               // null固定
      requestDate: today,
      expectedArrivalDate: null,
      status: "draft",
      lines: [],
    }));

    // 再検索はユーザー操作に任せる
  }

  // ローカル保存の復元（ヘッダのみ）
  useEffect(() => {
    const prefix = [draft.storeId ?? "-", draft.vendorMode, draft.vendorId ?? "-", ""].join("|");
    loadLatestDraftLike(prefix).then((rec) => {
      if (rec?.payload) {
        const p = rec.payload as Partial<OrderDraft>;
        setDraft((prev) => ({
          ...prev,
          storeId: p.storeId ?? prev.storeId,
          vendorMode: "all",         // ここは固定。p.vendorModeはもう信用しない
          vendorId: null,            // B案ではヘッダvendorIdは常にnull
          requestDate: p.requestDate ?? prev.requestDate,
          expectedArrivalDate: p.expectedArrivalDate ?? prev.expectedArrivalDate,
          taxRate: (typeof p.taxRate === "number" ? p.taxRate : prev.taxRate),
          status: p.status ?? prev.status,
        }));
      }
    }).catch(() => {/* noop */});
  // 初回のみ
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // cutoffMode切替時の初期選択
    if (cutoffMode === "fixed" && !fixedCutoff && availableCutoffs.length > 0) {
      setFixedCutoff(availableCutoffs[0]);
    }
  }, [cutoffMode, fixedCutoff, availableCutoffs]);

  const displayedLines = React.useMemo(() => {
  let base = draft.lines;

  // 締め固定モードで cutoff 固定を使ってるなら、
  // その締め時刻グループに属するベンダーだけに絞る
  if (cutoffMode === "fixed" && vendorIdsForFixed) {
    base = base.filter((ln) => {
      const vId = ln.vendorId;
      return vId ? vendorIdsForFixed.has(vId) : true;
    });
  }

  // 画面側の「表示フィルタ（ベンダー）」でさらに絞る
  if (filterVendorId) {
    base = base.filter((ln) => ln.vendorId === filterVendorId);
  }

  return base;
}, [draft.lines, cutoffMode, vendorIdsForFixed, filterVendorId]);

  const subtotal = useMemo(
    () => displayedLines.reduce((sum, l) => (sum + (l.qty || 0) * (l.unitPrice ?? 0)), 0),
    [displayedLines]
  );
  const tax = useMemo(() => Math.round(subtotal * draft.taxRate), [subtotal, draft.taxRate]);
  const total = subtotal + tax;

  // CSV（発注）
  const [delimiter, setDelimiter] = useState<"," | "\t">(",");
  const [includeHeader, setIncludeHeader] = useState<boolean>(true);

  function buildOrderCsvRows(
    d: OrderDraft,
    opts?: { includeHeader?: boolean }
  ): (string | number | null)[][] {
    const withHeader = opts?.includeHeader ?? true;
    const orderDate = d.requestDate;

    const calcArrival = (ln: OrderLine): string => {
      const raw = ln.expectedArrivalDate ?? d.expectedArrivalDate;

      // 行 or ヘッダに日付が入っている場合はそれを優先
      if (raw) {
        try {
          const base = new Date(raw + "T00:00:00");
          const yyyy = base.getFullYear();
          const mm = String(base.getMonth() + 1).padStart(2, "0");
          const dd = String(base.getDate()).padStart(2, "0");
          return `${yyyy}-${mm}-${dd}`;
        } catch {
          return raw;
        }
      }

      // フォールバック：ベンダーLT×発注日
      try {
        const item = itemsMap[ln.itemId ?? ""];
        const vRule = item ? vendorRules[item.vendorId] : undefined;
        const lt = vRule?.leadTimeDays ?? 1;
        const base = new Date(orderDate + "T00:00:00");
        base.setDate(base.getDate() + lt);
        const yyyy = base.getFullYear();
        const mm = String(base.getMonth() + 1).padStart(2, "0");
        const dd = String(base.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      } catch {
        return orderDate;
      }
    };

    // 名称の解決ヘルパ
    const getStoreName = () => serverStoreName || getStoreNameById(d.storeId);
    const getVendorName = (vendorId: string) =>
      (serverVendorNames[vendorId] ?? vendors.find(v => v.id === vendorId)?.name ?? "");
    const getItemName = (itemId: string) =>
      (serverItemNames[itemId] ?? itemsMap[itemId]?.name ?? "");

    const rows = d.lines
      .filter((ln) => (ln.qty ?? 0) !== 0)
      .map((ln) => {
        const item = itemsMap[ln.itemId ?? ""];
        const storeId = d.storeId ?? "";
        const storeName = getStoreName();
        const vendorId = item?.vendorId ?? d.vendorId ?? "";
        const vendorName = vendorId ? getVendorName(vendorId) : "";
        const itemId = ln.itemId ?? "";
        const itemName = itemId ? getItemName(itemId) : "";
        const qty = Number(ln.qty ?? 0);
        const unitPrice = Number(d.lines.find(x => x.lineId === ln.lineId)?.unitPrice ?? 0);
        const amount = (ln.qty || 0) * unitPrice;
        const arrivalDate = calcArrival(ln);

        // 出力：店舗コード, 店舗名, ベンダーコード, ベンダー名, 発注日, 納品日, 品目コード, 品目名, 数量, 単価, 金額
        return [
          storeId, storeName,
          vendorId, vendorName,
          orderDate, arrivalDate,
          itemId, itemName,
          qty, unitPrice.toFixed(2), amount
        ];
      });

    if (withHeader) {
      rows.unshift([
        "店舗コード", "店舗名",
        "ベンダーコード", "ベンダー名",
        "発注日", "納品日",
        "品目コード", "品目名",
        "数量", "単価", "金額"
      ]);
    }
    return rows;
  }


  function handleCsvDownload() {
    const rows = buildOrderCsvRows(draft, { includeHeader });
    const csv = toCsvString(rows, { delimiter });
    const ymd = (draft.requestDate || "").replaceAll("-", "");
    const store = draft.storeId ?? "store";
    const vendor = draft.vendorId ?? (draft.vendorMode === "all" ? "all" : "vendor");
    const ext = delimiter === "\t" ? "tsv" : "csv";
    const filename = `order_${store}_${vendor}_${ymd}.${ext}`;
    downloadCsv(filename, csv);
  }
  // 店舗モーダル
  function StoreSelectModal({
    open,
    onClose,
    stores,
    onSelect,
  }: {
    open: boolean;
    onClose: () => void;
    stores: StoreLite[];
    onSelect: (id: string, name: string) => void;
  }) {
    const [keyword, setKeyword] = useState("");

    const list = useMemo(() => {
      const kw = keyword.trim();
      if (!kw) return stores;
      const lower = kw.toLowerCase();
      return stores.filter(s =>
        s.id.includes(kw) || s.name.toLowerCase().includes(lower)
      );
    }, [keyword, stores]);

    if (!open) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
        <div className="bg-white rounded-xl shadow-lg w-[480px] max-w-[90vw]">
          <div className="px-4 py-3 border-b font-medium">店舗を選択</div>
          <div className="p-4 space-y-3">
            <input
              className="border rounded w-full px-2 py-1"
              placeholder="ID または 店名で検索"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <div className="max-h-72 overflow-auto border rounded">
              {list.length === 0 ? (
                <div className="p-3 text-sm text-slate-500">該当がありません</div>
              ) : (
                <ul>
                  {list.map(s => (
                    <li key={s.id}>
                      <button
                        className="w-full text-left px-3 py-2 hover:bg-slate-50"
                        onClick={() => { onSelect(s.id, s.name); onClose(); }}
                      >
                        <span className="font-mono mr-2">{s.id}</span>
                        <span>{s.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button className="px-3 py-1 border rounded" onClick={onClose}>閉じる</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- UI ---
  return (
  <div className="p-6 max-w-6xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-semibold">発注入力（プロトタイプ v1.5）</h1>
        <p className="text-sm text-muted-foreground mt-1">数量は整数のみ（最小/入数/刻み対応）、単価は小数可</p>
      </motion.div>

      {/* Header */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">ヘッダー</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-12 gap-4">
          {/* バナー（locked時のみ） */}
          {!draft.status || draft.status === "draft"
            ? null
            : (
              <div className="md:col-span-12 mb-2 rounded-xl bg-rose-50 text-rose-700 px-3 py-2 text-sm">
                {statusReason
                  ? statusReason
                  : "このデータは編集できません。履歴画面でご確認ください。"}
                {" "}
                <button className="underline ml-1" onClick={handleClearSearch}>検索条件クリア</button>
                を行ってください。
              </div>
            )
          } 

          {/* 店舗（ID入力＋ラベル＋選択モーダル） */}
          <div className="md:col-span-5">
            <Label className="block mb-1">店舗</Label>
            <div className="flex items-center gap-2">
              {/* 店舗ID入力（Enterで確定） */}
              <input
                value={storeIdInput}
                onChange={(e) => setStoreIdInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const id = normalizeStoreId(storeIdInput);
                    const name = getStoreNameById(id);
                    if (id && name) {
                      // 確定：draft に反映＆ラベル更新
                      setDraft(prev => ({ ...prev, storeId: id, status: "draft", lines: [] }));
                      setStoreNameLabel(name);
                      setIsPastLocked(false);
                      setIsSearchLocked(false);
                    } else {
                      // 見つからない場合はラベルをクリア（必要ならアラート等）
                      setStoreNameLabel("");
                    }
                  }
                }}
                placeholder="0001"
                className="border rounded px-2 py-1 w-28 font-mono"
                disabled={isSearchLocked || isPastLocked}
              />

              {/* 店名ラベル（読み取り専用） */}
              <div className="px-2 py-1 text-sm text-slate-700 bg-slate-100 rounded min-w-[8rem]">
                {storeNameLabel || "（店名未確定）"}
              </div>

              {/* 選択ボタン（モーダル） */}
              <button
                type="button"
                className="border rounded px-3 py-1"
                onClick={() => setStoreModalOpen(true)}
                disabled={isPastLocked}
              >
                選択
              </button>
            </div>
          </div>


          {/* 発注日 */}
          <div className="md:col-span-3">
            <Label className="block mb-1">発注日（営業日付）</Label>
            <Input
              type="date"
              value={draft.requestDate}
              disabled={isPastLocked}
              onChange={(e) => {
                const newDate = e.target.value;
                setDraft(prev => ({
                  ...prev,
                  requestDate: newDate,
                  status: "draft",
                  lines: [],
                }));
                setIsPastLocked(false);
                setIsSearchLocked(false);
              }}
            />
          </div>

          {/* 検索/クリア/履歴 */}
          <div className="md:col-span-4 flex items-end justify-end gap-2">
            <button
              className="rounded bg-blue-600 text-white px-4 py-1"
              onClick={() => void doSearch()}
              disabled={isPastLocked}
            >
              検索
            </button>
            <button className="border rounded px-3 py-1" onClick={handleClearSearch}>
              条件クリア
            </button>
            <a className="underline text-sm leading-8" href="#history">履歴</a>
          </div>

          {/* 2行目：締め時間 / ベンダーフィルタ */}
          <div className="md:col-span-6">
            <Label className="block mb-1">締め時間</Label>
            <div className="flex items-center gap-2">
              <select
                value={cutoffMode}
                onChange={(e) => {
                  const v = e.target.value as 'perVendor' | 'fixed';
                  setCutoffMode(v);
                  if (v === 'perVendor') setFixedCutoff(null);
                }}
                className="border rounded px-2 py-1"
                disabled={isPastLocked}
              >
                <option value="perVendor">ベンダー別（従来）</option>
                <option value="fixed">締め固定</option>
              </select>
              {cutoffMode === 'fixed' && (
                <select
                  value={fixedCutoff ?? ''}
                  onChange={(e) => setFixedCutoff(e.target.value || null)}
                  className="border rounded px-2 py-1"
                  disabled={isPastLocked}
                >
                  <option value="" disabled>締めを選択</option>
                  {availableCutoffs.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* 「表示対象」ラベルは削除。機能は“表示フィルタ（ベンダー）”として残す */}
          <div className="md:col-span-6">
            <Label className="block mb-1">表示フィルタ（ベンダー）</Label>
            <select
              value={filterVendorId ?? ""}
              onChange={(e) => setFilterVendorId(e.target.value || null)}
              className="border rounded px-2 py-1 w-full"
              disabled={isPastLocked}
            >
              <option value="">（全ベンダーを表示）</option>
              {vendors.map(v => (
                <option key={v.id} value={v.id}>{v.id} / {v.name}</option>
              ))}
            </select>

            {/* 選択中ベンダーの締め/LTを表示（従来機能そのまま） */}
            {!!orderRule && (
              <div className="text-xs text-muted-foreground mt-1">
                締め: <span className="tabular-nums">{orderRule.cutoffHHmm}</span>
                {" / "}
                LT: <span className="tabular-nums">{orderRule.leadTimeDays}</span>日
              </div>
            )}
          </div>
        </CardContent>
        {/* 店舗選択モーダル */}
        <StoreSelectModal
          open={storeModalOpen}
          onClose={() => setStoreModalOpen(false)}
          stores={stores}
          onSelect={(id, name) => {
            setStoreIdInput(id);
            setStoreNameLabel(name);
            setDraft(prev => ({ ...prev, storeId: id, status: "draft", lines: [] }));
            setIsPastLocked(false);
            setIsSearchLocked(false);
          }}
        />
      </Card>
      {/* Lines */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">明細（数量=整数のみ / 0行は送信対象外）</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-2 w-[36%]">材料名 / 規格</th>
                  <th className="py-2 pr-2 w-[10%] text-right">単価</th>
                  <th className="py-2 pr-2 w-[14%] text-right">数量</th>
                  <th className="py-2 pr-2 w-[10%]">単位</th>
                  <th className="py-2 pr-2 w-[16%]">納品予定日</th>
                  <th className="py-2 pr-2 w-[12%] text-right">小計</th>
                  <th className="py-2 pr-2 w-[18%]">注記</th>
                </tr>
              </thead>
              <tbody>
                {displayedLines.length === 0 ? (
                  <tr className="border-b">
                    <td className="py-4 pr-2 text-sm text-slate-500" colSpan={7}>
                      該当する明細がありません。
                      {filterVendorId && (
                        <>（ベンダー {filterVendorId} には、この日付・締切条件で対象の品目がありません）</>
                      )}
                    </td>
                  </tr>
                ) : (
                  displayedLines.map((line) => {
                    const item = itemsMap[line.itemId] || undefined;
                    const unitPrice = line.unitPrice ?? 0;
                    const amount = (line.qty || 0) * unitPrice;

                    // 行の expectedArrivalDate を優先して納品予定日を表示
                    const arrival = (() => {
                      const raw = line.expectedArrivalDate;

                      // サーバから日付が来ている場合
                      if (raw) {
                        try {
                          const d = new Date(raw + "T00:00:00");
                          return formatDateLocal(d);
                        } catch {
                          return raw;
                        }
                      }

                      // フォールバック：ベンダーLT×発注日（万一サーバが日付を返してこない場合）
                      try {
                        const vRule = vendorRules[line.vendorId];
                        const lt = vRule?.leadTimeDays ?? 1;
                        const d = new Date(draft.requestDate + "T00:00:00");
                        d.setDate(d.getDate() + lt);
                        return formatDateLocal(d);
                      } catch {
                        return draft.requestDate;
                      }
                    })();

                    // 数量入力ハンドラ
                    const onQtyChange = (v: string) => {
                      // 全角数字→半角
                      const half = v.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
                      if (/^\d*$/.test(half)) {
                        const n = half === "" ? 0 : Number(half);
                        setDraft(d => ({
                          ...d,
                          lines: d.lines.map(l => l.lineId === line.lineId ? ({ ...l, qty: n }) : l),
                        }));
                      }
                    };

                    return (
                      <tr key={line.lineId} className="border-b align-top">
                        {/* 材料名 / 規格 */}
                        <td className="py-2 pr-2">
                          <div className="font-medium">{item?.name || line.itemId || "-"}</div>
                          <div className="text-xs text-muted-foreground">{item?.spec || "-"}</div>
                        </td>

                        {/* 単価 */}
                        <td className="py-2 pr-2 text-right tabular-nums">
                          ¥{unitPrice.toLocaleString()}
                        </td>

                        {/* 数量 */}
                        <td className="py-2 pr-2">
                          <Input
                            inputMode="numeric"
                            className="text-right"
                            value={String(line.qty)}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onQtyChange(e.target.value)}
                            onFocus={(e) => e.target.select()}
                            onMouseUp={(e) => e.preventDefault()}
                            disabled={isLinesLocked}
                          />
                        </td>

                        {/* 単位 */}
                        <td className="py-2 pr-2">{item?.unit ?? "-"}</td>

                        {/* 納品予定日（LTから計算した日） */}
                        <td className="py-2 pr-2">{arrival}</td>

                        {/* 小計 */}
                        <td className="py-2 pr-2 text-right tabular-nums">
                          ¥{amount.toLocaleString()}
                        </td>

                        {/* 注記（ここではベンダーの締め/ＬＴなどを表示） */}
                        <td className="py-2 pr-2 text-xs text-muted-foreground">
                          {(() => {
                            const vId = line.vendorId;
                            if (typeof vId === "string") {
                              const rule = vendorRules[vId];
                              return rule
                                ? `締め ${rule.cutoffHHmm} / LT ${rule.leadTimeDays}日`
                                : "-";
                            }
                            return "-";
                          })()}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* フッター合計 */}
          <div className="flex justify-end items-center mt-4">
            <div className="text-right space-y-1">
              <div>小計：<span className="tabular-nums font-medium ml-1">¥{subtotal.toLocaleString()}</span></div>
              <div>消費税（{Math.round(draft.taxRate*100)}%）：<span className="tabular-nums font-medium ml-1">¥{tax.toLocaleString()}</span></div>
              <div className="text-lg">合計：<span className="tabular-nums font-semibold ml-1">¥{total.toLocaleString()}</span></div>
            </div>
          </div>

          {/* 送信/保存ボタン群 */}
          <div className="mt-4 flex flex-wrap gap-3 items-center justify-end">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeHeader}
                onChange={(e) => setIncludeHeader(e.target.checked)}
                disabled={isLocked}
              />
              ヘッダー行を付ける
            </label>
            <label className="flex items-center gap-2">
              区切り:
              <select
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value as "," | "\t")}
                className="border rounded px-2 py-1"
                disabled={isLocked}
              >
                <option value=",">カンマ (,)</option>
                <option value={"\t"}>タブ (\t)</option>
              </select>
            </label>
            <button
              disabled={
                !canSubmit ||
                (cutoffMode === 'fixed' && !fixedCutoff)
              }
              onClick={handleSend}
              className="rounded bg-blue-600 text-white px-4 py-1"
            >
              送信
            </button>
            <button
              className="border rounded px-3 py-1"
              onClick={handleCsvDownload}
              disabled={!displayedLines.some(l => (l.qty || 0) > 0)}
            >
              CSVダウンロード
            </button>
          </div>

          {/* 発注不可/締め超バナー */}
          {orderRule && !orderRule.orderable && (
            <div className="mb-3 rounded-xl bg-amber-50 text-amber-700 px-3 py-2 text-sm">
              本日はこのベンダーの発注不可日です。<strong>編集・送信できません</strong>。
            </div>
          )}
          {orderRule && orderRule.orderable && isPastCutoff(draft.requestDate, orderRule.cutoffHHmm) && (
            <div className="mb-3 rounded-xl bg-rose-50 text-rose-700 px-3 py-2 text-sm">
              締め時間（{orderRule.cutoffHHmm}）を過ぎたため、この注文は <strong>編集できません</strong>。
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  // 送信（POST）
  async function handleSend() {
    if (orderRule && !orderRule.orderable) {
      alert("本日はこのベンダーの発注不可日です。送信できません。");
      return;
    }
    if (draft.status === "confirmed" || isPastCutoff(draft.requestDate, cutoffFromRule)) {
      alert("締め時間を過ぎているため、送信できません。");
      return;
    }
    if (!confirm("この内容で送信しますか？（送信後も締め時間までは上書き可能です）")) return;

    const validLines: SubmitLine[] = (draft.lines ?? [])
      .map((l) => {
        const itemId = l.itemId!;
        const vendorId = (itemsMap[itemId]?.vendorId ?? "").trim();
        return {
          itemId,
          qty: Number(l.qty ?? 0),
          unitPrice: Number(l.unitPrice ?? 0),
          vendorId,                               // 行には必ず vendorId
          expectedArrivalDate: l.expectedArrivalDate ?? null,
        };
      })
      .filter((l) => Number.isInteger(l.qty) && l.qty > 0 && l.vendorId !== "");

    if (validLines.length === 0) {
      alert("数量が1以上の明細がありません。");
      return;
    }

    const dto = {
      storeId: draft.storeId ?? "",
      vendorMode: "all" as const, // ヘッダは常に all
      vendorId: null,               // ← any ではなく null 型
      orderDate: draft.requestDate,
      expectedArrivalDate: draft.expectedArrivalDate,
      taxRate: draft.taxRate,
      lines: validLines, // 行にvendorIdが入っている
    };
    
    try {
      const resp = await fetch("/ordering/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dto),
      });

      if (!resp.ok) {
        const msg = await resp.text();
        alert("送信エラー: " + msg);
        return;
      }

      const result = await resp.json();
      alert(`送信完了: 注文番号 ${result.orderId}\n合計金額: ¥${result.totals.total.toLocaleString()}`);

      // 送信後の初期化
      setIsSearchLocked(false);
      // setOrderRule(null);
      setDraft(prev => ({ ...prev, lines: [], status: "draft" }));
    } catch (e) {
      console.error(e);
      alert("ネットワークエラーが発生しました。");
    }
  }
}

// =========================
//  ルート：ナビゲーション統合
// =========================

type Route =
  | 'home'
  | 'order'
  | 'shipments'
  | 'inspection'
  | 'vendorEdit'
  | 'history'
  | 'storeInspection'
  | 'storeInspectionEdit'
  | 'audit';

export default function App() {
  const [route, setRoute] = useState<Route>('home');
  const [editId, setEditId] = useState<string | null>(null);
  const [vendorIdForEdit, setVendorIdForEdit] = useState<string | null>(null);
  const [inspectEditId, setInspectEditId] = useState<string | null>(null);
  const [storeOwnerId, setStoreOwnerId] = useState<string>("0002"); // 店舗検品の既定店舗ID

  // ハッシュ遷移（任意）：#order/#shipments/#inspection/#history/#inspection/store?ownerId=0001
  useEffect(() => {
    const applyFromHash = () => {
      const raw = location.hash || '';
      const [hashPath, queryStr] = raw.split('?');
      // ハッシュはそのまま扱う（'#/vendor/...' と '#shipments' の両方を許容）
      const h = (hashPath || '');
      const q = new URLSearchParams(queryStr || '');
      const ownerId = q.get('ownerId') || undefined;
      if (ownerId) setStoreOwnerId(ownerId);

      // 出荷（一覧／編集）を優先順で解釈（edit → 一覧 → 旧 #shipments）
      if (
        h.startsWith('#/vendor/shipments/edit') ||
        h.startsWith('#vendor/shipments/edit')    // 互換: もし既存で '#vendor/...' が来ても拾う
      ) {
        // クエリから編集IDを取り込む（new も可）
        const hdr = q.get('id') || q.get('headerId') || 'new';
        setEditId(hdr);
         // 併せて vendorId も保持（無ければ sessionStorage の直近値）
        const vid = q.get('vendorId')
          || sessionStorage.getItem('shipments.vendorId')
          || '';
        setVendorIdForEdit(vid);
        setRoute('vendorEdit');
      } else if (
        h.startsWith('#/vendor/shipments') ||
        h.startsWith('#vendor/shipments') ||       // 互換
        h.startsWith('#shipments')                  // 旧式
      ) {
        setRoute('shipments');
      }
      else if (h.startsWith('#inspection/store')) setRoute('storeInspection');
      else if (h.startsWith('#inspection')) setRoute('inspection');
      else if (h.startsWith('#history')) setRoute('history');
      else if (h.startsWith('#audit')) setRoute('audit');
      else if (h.startsWith('#home') || h === '' || h === '#') {
        setRoute('home');              // ハッシュ無し or #home はホームへ
      } else {
        setRoute('order');             // 想定外は一応発注へ
      }
    };
    window.addEventListener('hashchange', applyFromHash);
    applyFromHash();
    return () => window.removeEventListener('hashchange', applyFromHash);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r bg-white/90 backdrop-blur">
        <div className="px-4 py-3 flex items-center gap-2 border-b">
          <Menu size={18} />
          <span className="font-semibold">業務メニュー</span>
        </div>
        <nav className="p-2 space-y-1 text-sm">
          <NavItem
            icon={<Home size={16} />}
            label="ホーム"
            active={route === 'home'}
            onClick={() => {
              // ルーティングの単一の真実を hash に寄せる
              location.hash = '#home';
            }}
          />
          <NavItem
            icon={<ListOrdered size={16} />}
            label="発注入力"
            active={route==='order'}
            onClick={() => { location.hash = '#order'; }}
          />
          <NavItem
            icon={<Truck size={16} />}
            label="出荷"
            active={route==='shipments'}
            onClick={() => { location.hash = '#/vendor/shipments'; }}
          />
          <NavItem
            icon={<ClipboardCheck size={16} />}
            label="検品（ベンダー）"
            active={route==='inspection'}
            onClick={() => { location.hash = '#inspection'; }}
          />
          <NavItem
            icon={<ClipboardCheck size={16} />}
            label="検品（店舗）"
            active={route==='storeInspection'}
            onClick={() => {
              location.hash = `#inspection/store?ownerId=${encodeURIComponent(storeOwnerId)}`;
            }}
          />
          <NavItem
            icon={<History size={16} />}
            label="履歴"
            active={route==='history'}
            onClick={() => { location.hash = '#history'; }}
          />
          <NavItem
            icon={<History size={16} />}
            label="監査ログ"
            active={route==='audit'}
            onClick={() => { location.hash = '#audit'; }}
          />
        </nav>
      </aside>

      {/* Main */}
      <main className="flex-1 p-4">
        <Suspense fallback={<div className="p-6 text-slate-600">読み込み中...</div>}>
          {route === 'home' && (
            <HomeDashboard
              businessDate={getTodayBusinessYmd()}
              storeOwnerId={storeOwnerId}
              onGoOrder={() => { location.hash = '#order'; }}
              onGoShipments={() => { location.hash = '#/vendor/shipments'; }}
              onGoStoreInspection={() => {
                location.hash = `#inspection/store?ownerId=${encodeURIComponent(storeOwnerId)}`;
              }}
            />
          )}
          {route === 'order' && <OrderEntryPrototype />}
          {route === 'shipments' && (
            <VendorShipments
              onEdit={(id: string, vId?: string) => {
                setEditId(id);
                if (vId) {
                  const padded = String(vId).replace(/\D/g, "").padStart(6, "0");
                  setVendorIdForEdit(padded);
                }
                setRoute('vendorEdit');
              }}
            />
          )}
          {route === 'vendorEdit' && (
            <VendorEdit
              headerId={editId || 'new'}
              onBack={() => setRoute('shipments')}
              initialVendorId={vendorIdForEdit || undefined}
            />
          )}
          {route === 'inspection' && (
            <VendorInspectionList
              // dcId="DC01"
              dcId="600502"
              onBack={() => {
                setRoute('order');
                location.hash = '#order';
              }}
              onEdit={(headerId) => {
                setEditId(headerId);
                setRoute('vendorEdit');
                location.hash = `#/vendor/shipments/edit?id=${encodeURIComponent(headerId)}`;
              }}
            />
          )}

          {route === 'history' && <HistoryPage />}

          {route === 'storeInspection' && (
            <StoreInspectionList
              ownerType="STORE"
              ownerId={storeOwnerId}
              onEdit={(hid: string) => { setInspectEditId(hid); setRoute('storeInspectionEdit'); }}
              onBack={() => setRoute('order')}
            />
          )}

          {route === 'storeInspectionEdit' && (
            <StoreInspectionEdit
              headerId={inspectEditId || ''}
              onBack={() => setRoute('storeInspection')}
              ownerId={storeOwnerId}
            />
          )}

          {route === 'audit' && <AuditView />} 

        </Suspense>
      </main>
    </div>
  );
}

// App コンポーネントの下あたり（NavItem の定義より上）に追加

function HomeDashboard(props: {
  businessDate: string;
  storeOwnerId: string;
  onGoOrder: () => void;
  onGoShipments: () => void;
  onGoStoreInspection: () => void;
}) {
  const { businessDate, storeOwnerId, onGoOrder, onGoShipments, onGoStoreInspection } = props;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">今日の業務</h1>
        <p className="text-sm text-slate-600 mt-1">
          営業日付：<span className="font-mono">{businessDate}</span>
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {/* 今日の発注 */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <ListOrdered size={16} />
              今日の発注
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>営業日付 {businessDate} の発注画面を開きます。</p>
            <button
              type="button"
              className="border rounded px-3 py-1 text-sm bg-blue-600 text-white"
              onClick={onGoOrder}
            >
              発注入力へ
            </button>
          </CardContent>
        </Card>

        {/* 今日の入荷予定（出荷） */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Truck size={16} />
              今日の入荷予定
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>ベンダー側の出荷一覧から、今日の納品分を確認します。</p>
            <button
              type="button"
              className="border rounded px-3 py-1 text-sm bg-blue-600 text-white"
              onClick={onGoShipments}
            >
              出荷一覧へ
            </button>
          </CardContent>
        </Card>

        {/* 今日の検品（店舗） */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardCheck size={16} />
              今日の検品（店舗）
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>店舗 { /* 店舗IDをそのまま出しておく */ }
              <span className="font-mono">{storeOwnerId}</span> の検品一覧を開きます。
            </p>
            <button
              type="button"
              className="border rounded px-3 py-1 text-sm bg-blue-600 text-white"
              onClick={onGoStoreInspection}
            >
              店舗検品へ
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-slate-100 ${active ? 'bg-slate-100 font-medium' : ''}`}
      onClick={onClick}
    >
      <span className="text-slate-700">{icon}</span>
      <span className="text-slate-800">{label}</span>
    </button>
  );
}
