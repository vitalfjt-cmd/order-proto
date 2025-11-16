"use strict";
/**
 * server.ts — OrderEntryPrototype backend
 * - DB: better-sqlite3（Env: DB_PATH で切替可）
 * - Endpoints:
 *   GET  /items?vendorId=VND01
 *   GET  /ordering/rules?storeId=S001&vendorId=VND01&orderDate=2025-10-15
 *   POST /ordering/submit
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
// ====== Config ======
const PORT = Number(process.env.PORT || 8080);
// const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "app.sqlite"); // お使いのパスに合わせてOK
const DB_PATH = process.env.DB_PATH || path_1.default.join(process.cwd(), "db", "data.sqlite"); // お使いのパスに合わせてOK
// ====== App / DB ======
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: "2mb" }));
const db = new better_sqlite3_1.default(DB_PATH, { fileMustExist: true });
// ====== Utils ======
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseHM = (hhmm) => {
    const [h, m] = (hhmm || "04:00").split(":").map((n) => Number(n));
    return { h: Number.isFinite(h) ? h : 4, m: Number.isFinite(m) ? m : 0 };
};
/** “営業日翌日の HH:mm が締め” として締め日時を作る */
function computeCutoffDate(orderDate, hhmm) {
    const d = new Date(orderDate + "T00:00:00");
    d.setDate(d.getDate() + 1);
    const { h, m } = parseHM(hhmm);
    d.setHours(h, m, 0, 0);
    return d;
}
function isOrderableNow(orderDate, cutoffHHmm) {
    const cutoff = computeCutoffDate(orderDate, cutoffHHmm);
    return new Date() <= cutoff;
}
// ====== Rule / Price resolvers ======
/** 曜日 0..6（日..土） */
function weekdayOf(dateStr) {
    return new Date(dateStr + "T00:00:00").getDay();
}
/**
 * 店舗×ベンダー×曜日の最終ルールを解決
 * - store_vendor_overrides が優先
 * - なければ vendor_weekly_rules
 * - 欠損は デフォルト { orderable:1, cutoff:"04:00", lead:1 }
 */
function resolveRule(storeId, vendorId, orderDate) {
    const w = weekdayOf(orderDate);
    const ov = db
        .prepare(`SELECT orderable,
              cutoff_hhmm   AS cutoffHHmm,
              lead_time_days AS leadTimeDays
         FROM store_vendor_overrides
        WHERE store_id=? AND vendor_id=? AND weekday=?`)
        .get(storeId, vendorId, w);
    const base = db
        .prepare(`SELECT orderable,
              cutoff_hhmm   AS cutoffHHmm,
              lead_time_days AS leadTimeDays
         FROM vendor_weekly_rules
        WHERE vendor_id=? AND weekday=?`)
        .get(vendorId, w);
    const orderable = (ov?.orderable ?? base?.orderable ?? 1) === 1;
    const cutoffHHmm = ov?.cutoffHHmm ?? base?.cutoffHHmm ?? "04:00";
    const leadTimeDays = ov?.leadTimeDays ?? base?.leadTimeDays ?? 1;
    return { orderable, cutoffHHmm, leadTimeDays };
}
/** アイテムの標準ベンダー（vendorMode=all の場合に補助） */
function vendorForItem(itemId, dateYmd) {
    const row = db
        .prepare(`SELECT vendor_id AS vendorId
         FROM item_prices
        WHERE item_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?)
        ORDER BY valid_from DESC
        LIMIT 1`)
        .get(itemId, dateYmd, dateYmd);
    return row?.vendorId ?? null;
}
/** 単価（有効期間内の最新） */
function unitPriceFor(vendorId, itemId, date) {
    const row = db
        .prepare(`SELECT unit_price AS price
         FROM item_prices
        WHERE vendor_id=? AND item_id=? AND valid_from<=?
          AND (valid_to IS NULL OR valid_to>=?)
        ORDER BY valid_from DESC
        LIMIT 1`)
        .get(vendorId, itemId, date, date);
    return row?.price ?? null;
}
// ====== Endpoints ======
app.get("/health", (_req, res) => res.json({ ok: true, now: new Date().toISOString() }));
/**
 * GET /items?vendorId=VND01
 *   - フロントの一覧表示用（既存互換）
 */
// app.get("/items", (req, res) => {
//   const vendorId = String(req.query.vendorId || "");
//   if (!vendorId) return res.status(400).json({ error: "vendorId is required" });
//   const rows = db
//     .prepare(
//       `SELECT i.id, i.name, i.spec, i.unit, ? AS vendorId
//          FROM items i
//          JOIN item_prices p ON p.item_id = i.id
//         WHERE p.vendor_id = ?
//         GROUP BY i.id
//         ORDER BY i.name`
//     )
//     // .all(vendorId);
//     .all(vendorId, vendorId);
//   res.json({ items: rows });
// });
// GET /items?vendorId=VND01
// app.get("/items", (req, res) => {
//   const vendorId = String(req.query.vendorId || "");
//   if (!vendorId) return res.status(400).json({ error: "vendorId is required" });
//   try {
//     const rows = db.prepare(
//       `SELECT i.id, i.name, i.spec, i.unit, ? AS vendorId
//          FROM items i
//         WHERE EXISTS (
//                 SELECT 1
//                   FROM item_prices p
//                  WHERE p.item_id = i.id
//                    AND p.vendor_id = ?       -- ← ここだけ item_prices を参照
//               )
//         ORDER BY i.id`
//     ).all(vendorId, vendorId);
//     res.json({ items: rows });
//   } catch (e: any) {
//     console.error("[/items] error:", e);
//     res.status(500).json({ error: String(e) });
//   }
// });
// === REPLACE ALL: /items endpoint (EXISTS版 + marker log) ===
app.get("/items", (req, res) => {
    console.log("[/items] handler: EXISTS-version is running"); // ★目印ログ
    const vendorId = String(req.query.vendorId || "");
    if (!vendorId)
        return res.status(400).json({ error: "vendorId is required" });
    try {
        const sql = `
      SELECT i.id, i.name, i.spec, i.unit, ? AS vendorId
        FROM items i
       WHERE EXISTS (
               SELECT 1
                 FROM item_prices p
                WHERE p.item_id = i.id
                  AND p.vendor_id = ?
             )
       ORDER BY i.id
    `;
        const rows = db.prepare(sql).all(vendorId, vendorId);
        res.json({ items: rows });
    }
    catch (e) {
        console.error("[/items] error:", e);
        res.status(500).json({ error: String(e) });
    }
});
/**
 * GET /ordering/rules?storeId=S001&vendorId=VND01&orderDate=YYYY-MM-DD
 *   - 締め・LT・曜日可否の提示（既存互換）
 */
app.get("/ordering/rules", (req, res) => {
    const storeId = String(req.query.storeId || "");
    const vendorId = String(req.query.vendorId || "");
    const orderDate = String(req.query.orderDate || "");
    if (!storeId || !vendorId || !orderDate)
        return res.status(400).json({ error: "storeId, vendorId, orderDate are required" });
    const rule = resolveRule(storeId, vendorId, orderDate);
    res.json({
        storeId,
        vendorId,
        orderDate,
        cutoffHHmm: rule.cutoffHHmm,
        leadTimeDays: rule.leadTimeDays,
        orderable: rule.orderable,
        editableNow: rule.orderable && isOrderableNow(orderDate, rule.cutoffHHmm),
    });
});
/**
 * POST /ordering/submit
 *  - フロントの handleSend() が送る dto を受ける
 *  - 価格はサーバで再決定、金額を再計算
 *  - vendorMode=single のときのみ締め/曜日チェックを強制
 */
app.post("/ordering/submit", (req, res) => {
    const b = req.body;
    const errors = [];
    if (!b?.storeId)
        errors.push("storeId は必須です。");
    if (!b?.orderDate)
        errors.push("orderDate は必須です。");
    if (!Array.isArray(b?.lines) || b.lines.length === 0)
        errors.push("lines は1件以上が必要です。");
    if (b.vendorMode === "single" && !b.vendorId)
        errors.push("vendorMode='single' の場合 vendorId は必須です。");
    (b.lines || []).forEach((ln, i) => {
        if (!ln?.itemId)
            errors.push(`lines[${i}].itemId がありません。`);
        if (!Number.isInteger(ln?.qty) || ln.qty <= 0)
            errors.push(`lines[${i}].qty は 1 以上の整数です。`);
    });
    if (errors.length)
        return res.status(400).json({ status: "error", errors });
    // --- ルール取得とチェック（single のときだけ強制） ---
    let rule = { orderable: true, cutoffHHmm: "04:00", leadTimeDays: 1 };
    if (b.vendorMode === "single" && b.vendorId) {
        rule = resolveRule(b.storeId, b.vendorId, b.orderDate);
        if (!rule.orderable) {
            return res.status(400).json({ status: "error", errors: ["当日はこのベンダーの発注不可日です。"] });
        }
        if (!isOrderableNow(b.orderDate, rule.cutoffHHmm)) {
            return res
                .status(400)
                .json({ status: "error", errors: [`締め ${rule.cutoffHHmm} を過ぎているため送信できません。`] });
        }
    }
    // --- サーバ側で単価確定・金額再計算 ---
    const taxRate = typeof b.taxRate === "number" ? b.taxRate : 0.1;
    let subtotal = 0;
    const normalizedLines = b.lines.map((ln) => {
        // vendorMode=single → その vendorId、all → アイテムの標準ベンダー
        // const vId = b.vendorId || vendorForItem(ln.itemId);
        const vId = b.vendorId || vendorForItem(ln.itemId, b.orderDate);
        // 価格：item_prices に存在すれば採用、なければ入力値（unitPrice）→ それもなければ 0
        const priceFromDb = vId ? unitPriceFor(vId, ln.itemId, b.orderDate) : null;
        const unitPrice = priceFromDb ?? (typeof ln.unitPrice === "number" ? ln.unitPrice : 0);
        const amount = unitPrice * ln.qty;
        subtotal += amount;
        // 納品予定日：dto 指定 > ルール（leadTimeDays）で計算 > null
        let expectedArrivalDate = b.expectedArrivalDate ?? null;
        if (!expectedArrivalDate) {
            const base = new Date(b.orderDate + "T00:00:00");
            const lt = rule.leadTimeDays ?? 1;
            base.setDate(base.getDate() + lt);
            expectedArrivalDate = ymd(base);
        }
        return {
            itemId: ln.itemId,
            qty: ln.qty,
            unitPrice,
            amount,
            vendorId: vId,
            expectedArrivalDate,
        };
    });
    const tax = Math.round(subtotal * taxRate);
    const total = subtotal + tax;
    // --- idempotency（短時間の重複送信を弾く）---
    const key = {
        storeId: b.storeId,
        vendorMode: b.vendorMode,
        vendorId: b.vendorId,
        orderDate: b.orderDate,
        lines: normalizedLines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitPrice: l.unitPrice })),
        subtotal,
        tax,
        total,
    };
    const hash = crypto_1.default.createHash("sha256").update(JSON.stringify(key)).digest("hex");
    const orderId = `O${ymd(new Date())}-${hash.slice(0, 8)}`;
    // ※ 永続化は必要に応じてここで DB に INSERT してください（orders / order_lines など）
    //   まずは PoC 段階なので応答のみ。
    return res.status(201).json({
        status: "accepted",
        orderId,
        totals: { subtotal, tax, total, taxRate },
        acceptedLines: normalizedLines.length,
    });
});
// CORS（proxyを使うなら不要だが、直叩きでも通せるよう保険で入れておく）
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "http://localhost:5173");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS")
        return res.sendStatus(204);
    next();
});
// TEMP: 実DBの item_prices の列名確認
app.get("/_debug/item_prices_columns", (_req, res) => {
    const cols = db.prepare("PRAGMA table_info(item_prices)").all();
    res.json(cols);
});
// ====== Start ======
app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}  (db=${DB_PATH})`);
});
