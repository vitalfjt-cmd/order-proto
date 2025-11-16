/**
 * server.ts — OrderEntryPrototype backend
 * - DB: better-sqlite3（Env: DB_PATH で切替可）
 * - Endpoints:
 *   GET  /items?vendorId=VND01
 *   GET  /ordering/rules?storeId=S001&vendorId=VND01&orderDate=2025-10-15
 *   POST /ordering/submit
 */

// import express from "express";
// import cors from 'cors';
// import Database from "better-sqlite3";
// import path from "path";
// import crypto from "crypto";


// start
// // ========================
// // 型定義
// // ========================
// type VendorRow = {
//   vendorId: string;
//   vendorName: string;
// };

// type VendorRuleResult = {
//   vendorId: string;
//   vendorName: string;
//   orderable: boolean;
//   isClosed: boolean;
//   cutoffTime: string | null;
//   leadTimeDays: number | null;
//   deliveryDate: string | null;
//   notes: string | null;
// };

// type RulesSummary = {
//   anyOrderable: boolean;
//   allClosed: boolean;
//   earliestCutoffTime: string | null;
//   statusText: string;
// };

// type RulesResponse = {
//   storeId: string;
//   orderDate: string;
//   cutoffCheckedAt: string;
//   vendors: VendorRuleResult[];
//   summary: RulesSummary;
// };

// type IdRow = { id: number };

// // JST現在時刻を "HH:MM"
// function nowHHmmJST(): string {
//   const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
//   const hh = String(jst.getUTCHours()).padStart(2, '0');
//   const mm = String(jst.getUTCMinutes()).padStart(2, '0');
//   return `${hh}:${mm}`;
// }

// type AggRow = {
//   vendor_id: string;
//   destination_id: string;
//   delivery_date: string;     // 'YYYY-MM-DD'
//   item_id: string;
//   sum_qty: number;
//   unit_price: number;
//   cutoff_hhmm: string;
//   lead_time_days: number;
// };

// type HeaderGroup = {
//   vendor_id: string;
//   destination_id: string;
//   delivery_date: string;
//   lines: Array<{
//     item_id: string;
//     ordered_qty: number;
//     ship_qty: number;
//     unit_price: number;
//     amount: number;
//   }>;
// };

// // ========================
// // 日付/時間ユーティリティ
// // ========================

// // "2025-11-03" -> Date(JST 00:00)
// function ymdToDateJst(ymd: string): Date {
//   return new Date(`${ymd}T00:00:00+09:00`);
// }

// // Date -> "YYYY-MM-DD"
// function formatAsYmd(dateObj: Date): string {
//   const y = dateObj.getFullYear();
//   const m = (dateObj.getMonth() + 1).toString().padStart(2, "0");
//   const d = dateObj.getDate().toString().padStart(2, "0");
//   return `${y}-${m}-${d}`;
// }

// // JST基準の「今日」を "YYYY-MM-DD" 文字列で返す
// function getTodayYmdJst(): string {
//   // いったんサーバローカル時刻をJST扱いで簡易に返す
//   // 将来、厳密にするなら Intl.DateTimeFormat(... timeZone:'Asia/Tokyo') に置き換える
//   const now = new Date();
//   return formatAsYmd(now);
// }

// // 指定日付の曜日 (0=Sun ... 6=Sat)
// function getDow(orderDate: string): number {
//   const d = ymdToDateJst(orderDate);
//   return d.getDay();
// }

// // 締切を過ぎているか？
// // ルール: 
// //  - orderDate < 今日 → true（もう締め扱い）
// //  - orderDate > 今日 → false（未来日はまだOK）
// //  - 同日なら cutoffHHMM と現在時刻を比較
// function isClosedNow(orderDate: string, cutoffHHMM: string | null): boolean {
//   const todayYmd = getTodayYmdJst();

//   if (orderDate < todayYmd) return true;
//   if (orderDate > todayYmd) return false;

//   // 同日だけ締切で比較
//   if (!cutoffHHMM) {
//     // cutoff未設定は安全側でロック扱い
//     return true;
//   }

//   const now = new Date(); // サーバローカルをJST扱いでOKスタート

//   const [hhStr, mmStr] = cutoffHHMM.split(":");
//   const hh = Number(hhStr);
//   const mm = Number(mmStr);

//   const cutoffDt = new Date(
//     `${orderDate}T${hh.toString().padStart(2,"0")}:${mm
//       .toString()
//       .padStart(2,"0")}:00+09:00`
//   );

//   return now >= cutoffDt;
// }

// // 納品予定日 = orderDate + leadTimeDays（日数足し）
// function calcDeliveryDate(
//   orderDate: string,
//   leadTimeDays: number | null
// ): string | null {
//   if (leadTimeDays == null) return null;
//   const base = ymdToDateJst(orderDate);
//   base.setDate(base.getDate() + leadTimeDays);
//   return formatAsYmd(base);
// }

// // summaryの文言
// function buildStatusText(anyOrderable: boolean, allClosed: boolean): string {
//   if (!anyOrderable) {
//     return "本日はこの店舗からの発注はできません";
//   }
//   if (allClosed) {
//     return "本日の発注受付は締切済みです";
//   }
//   return "一部の仕入先は締切済みです";
// }

// // ========================
// // DBアクセス系ヘルパ
// // ========================

// // vendor_weekly_rules 取得
// function loadWeeklyRuleForVendor(db: any, vendorId: string) {
//   return db
//     .prepare(
//       `
//     SELECT
//       orderable_sun, cutoff_hhmm_sun, lead_time_days_sun,
//       orderable_mon, cutoff_hhmm_mon, lead_time_days_mon,
//       orderable_tue, cutoff_hhmm_tue, lead_time_days_tue,
//       orderable_wed, cutoff_hhmm_wed, lead_time_days_wed,
//       orderable_thu, cutoff_hhmm_thu, lead_time_days_thu,
//       orderable_fri, cutoff_hhmm_fri, lead_time_days_fri,
//       orderable_sat, cutoff_hhmm_sat, lead_time_days_sat
//     FROM vendor_weekly_rules
//     WHERE vendor_id = ?
//     `
//     )
//     .get(vendorId);
// }

// // store_vendor_overrides 取得
// function loadOverrideForStoreVendor(db: any, storeId: string, vendorId: string) {
//   return db
//     .prepare(
//       `
//     SELECT
//       orderable_sun_override, cutoff_hhmm_sun_override, lead_time_days_sun_override,
//       orderable_mon_override, cutoff_hhmm_mon_override, lead_time_days_mon_override,
//       orderable_tue_override, cutoff_hhmm_tue_override, lead_time_days_tue_override,
//       orderable_wed_override, cutoff_hhmm_wed_override, lead_time_days_wed_override,
//       orderable_thu_override, cutoff_hhmm_thu_override, lead_time_days_thu_override,
//       orderable_fri_override, cutoff_hhmm_fri_override, lead_time_days_fri_override,
//       orderable_sat_override, cutoff_hhmm_sat_override, lead_time_days_sat_override
//     FROM store_vendor_overrides
//     WHERE store_id = ? AND vendor_id = ?
//     `
//     )
//     .get(storeId, vendorId);
// }

// // dow(0=Sun..6=Sat)に応じた1日分のルールを作る
// function pickRuleForDow(
//   dow: number,
//   baseRule: any,
//   overrideRule: any | undefined
// ) {
//   const map = [
//     {
//       o: "orderable_sun",
//       c: "cutoff_hhmm_sun",
//       l: "lead_time_days_sun",
//       oo: "orderable_sun_override",
//       cc: "cutoff_hhmm_sun_override",
//       ll: "lead_time_days_sun_override",
//     },
//     {
//       o: "orderable_mon",
//       c: "cutoff_hhmm_mon",
//       l: "lead_time_days_mon",
//       oo: "orderable_mon_override",
//       cc: "cutoff_hhmm_mon_override",
//       ll: "lead_time_days_mon_override",
//     },
//     {
//       o: "orderable_tue",
//       c: "cutoff_hhmm_tue",
//       l: "lead_time_days_tue",
//       oo: "orderable_tue_override",
//       cc: "cutoff_hhmm_tue_override",
//       ll: "lead_time_days_tue_override",
//     },
//     {
//       o: "orderable_wed",
//       c: "cutoff_hhmm_wed",
//       l: "lead_time_days_wed",
//       oo: "orderable_wed_override",
//       cc: "cutoff_hhmm_wed_override",
//       ll: "lead_time_days_wed_override",
//     },
//     {
//       o: "orderable_thu",
//       c: "cutoff_hhmm_thu",
//       l: "lead_time_days_thu",
//       oo: "orderable_thu_override",
//       cc: "cutoff_hhmm_thu_override",
//       ll: "lead_time_days_thu_override",
//     },
//     {
//       o: "orderable_fri",
//       c: "cutoff_hhmm_fri",
//       l: "lead_time_days_fri",
//       oo: "orderable_fri_override",
//       cc: "cutoff_hhmm_fri_override",
//       ll: "lead_time_days_fri_override",
//     },
//     {
//       o: "orderable_sat",
//       c: "cutoff_hhmm_sat",
//       l: "lead_time_days_sat",
//       oo: "orderable_sat_override",
//       cc: "cutoff_hhmm_sat_override",
//       ll: "lead_time_days_sat_override",
//     },
//   ][dow];

//   const orderableRaw =
//     overrideRule && overrideRule[map.oo] != null
//       ? overrideRule[map.oo]
//       : baseRule?.[map.o];

//   const cutoffRaw =
//     overrideRule && overrideRule[map.cc] != null
//       ? overrideRule[map.cc]
//       : baseRule?.[map.c];

//   const ltRaw =
//     overrideRule && overrideRule[map.ll] != null
//       ? overrideRule[map.ll]
//       : baseRule?.[map.l];

//   return {
//     orderable: !!orderableRaw, // number(0/1) -> boolean
//     cutoffHHMM: cutoffRaw ?? null,
//     leadTimeDays: ltRaw ?? null,
//     note: null, // 将来: 祝日などの特記事項を入れる
//   };
// }
// function loadStoreName(db: any, storeId: string): string {
//   const row = db.prepare(`SELECT name FROM stores WHERE id = ?`).get(storeId);
//   return row ? String(row.name) : "";
// }

// /** 店舗が扱うベンダー名のマップ（vendorId -> vendorName）*/
// function loadVendorNamesForStore(db: any, storeId: string): Record<string, string> {
//   const rows = db.prepare(`
//     SELECT DISTINCT v.id AS id, v.name AS name
//       FROM store_vendor_items svi
//       JOIN vendors v ON v.id = svi.vendor_id
//      WHERE svi.store_id = ?
//   `).all(storeId) as { id: string; name: string }[];
//   const out: Record<string, string> = {};
//   for (const r of rows) out[r.id] = r.name ?? "";
//   return out;
// }

// /** 店舗が扱う品目名のマップ（itemId -> itemName）*/
// function loadItemNamesForStore(db: any, storeId: string): Record<string, string> {
//   const rows = db.prepare(`
//     SELECT DISTINCT i.id AS id, i.name AS name
//       FROM store_vendor_items svi
//       JOIN items i ON i.id = svi.item_id
//      WHERE svi.store_id = ?
//   `).all(storeId) as { id: string; name: string }[];
//   const out: Record<string, string> = {};
//   for (const r of rows) out[r.id] = r.name ?? "";
//   return out;
// }

// function getOne<T>(sql: string, params: Record<string, unknown>): T | undefined {
//   return db.prepare(sql).get(params) as T | undefined;
// }

// // --- 日付ユーティリティ（orderDate "YYYY-MM-DD" → 0(日)〜6(土)） ---
// // YYYY-MM-DD → 0(日)～6(土)
// function weekdayFromYmd(ymd: string): number {
//   const d = new Date(ymd + "T00:00:00");
//   return d.getDay();
// }

// // 営業日(ビジネス日付)の計算
// // 今はシンプルに「今日の日付を返す」運用でOK
// function getBusinessDate() {
//   const now = new Date();
//   const yyyy = now.getFullYear().toString().padStart(4, "0");
//   const mm = (now.getMonth() + 1).toString().padStart(2, "0");
//   const dd = now.getDate().toString().padStart(2, "0");
//   const businessDate = `${yyyy}-${mm}-${dd}`;
//   return { businessDate };
// }

// // vendor_weekly_rules + store_vendor_override から
// // 指定日のルール（orderable/cutoffHHmm/leadTimeDays）を1ベンダー分つくる。
// // 見つからなければ null を返す。
// function pickVendorRuleForDay(opts: {
//   storeId: string;
//   vendorId: string;
//   orderDate: string;
// }) {
//   const { storeId, vendorId, orderDate } = opts;

//   // 1) ベース: vendor_weekly_rules（曜日別）
//   // 例:
//   // vendor_weekly_rules(
//   //   vendor_id TEXT,
//   //   cutoff_hhmm_sun TEXT, lead_time_days_sun INTEGER, orderable_sun INTEGER,
//   //   cutoff_hhmm_mon TEXT, ...
//   // )
//   const wday = weekdayFromYmd(orderDate); // 0(日)～6(土)
//   const baseRuleRow = db.prepare(`
//     SELECT *
//     FROM vendor_weekly_rules
//     WHERE vendor_id = ?
//   `).get(vendorId) as any | undefined;

//   if (!baseRuleRow) {
//     // ベンダーの週次ルールすら無い → 発注不可として扱う
//     return null;
//   }

//   // wdayごとにカラム名を決める
//   const cutoffCol = [
//     "cutoff_hhmm_sun","cutoff_hhmm_mon","cutoff_hhmm_tue","cutoff_hhmm_wed",
//     "cutoff_hhmm_thu","cutoff_hhmm_fri","cutoff_hhmm_sat",
//   ][wday];
//   const ltCol = [
//     "lead_time_days_sun","lead_time_days_mon","lead_time_days_tue","lead_time_days_wed",
//     "lead_time_days_thu","lead_time_days_fri","lead_time_days_sat",
//   ][wday];
//   const orderableCol = [
//     "orderable_sun","orderable_mon","orderable_tue","orderable_wed",
//     "orderable_thu","orderable_fri","orderable_sat",
//   ][wday];

//   let rule = {
//     orderable: !!baseRuleRow[orderableCol],
//     cutoffHHmm: baseRuleRow[cutoffCol] ?? "00:00",
//     leadTimeDays: Number(baseRuleRow[ltCol] ?? 1),
//   };

//   const ovRow = db.prepare(`
//     SELECT *
//     FROM store_vendor_overrides
//     WHERE store_id = ?
//       AND vendor_id = ?
//       AND override_date = ?
//     LIMIT 1
//   `).get(storeId, vendorId, orderDate) as any | undefined;

//   if (ovRow) {
//     if (ovRow.orderable !== null && ovRow.orderable !== undefined) {
//       rule.orderable = !!ovRow.orderable;
//     }
//     if (ovRow.cutoff_hhmm) {
//       rule.cutoffHHmm = ovRow.cutoff_hhmm;
//     }
//     if (ovRow.lead_time_days !== null && ovRow.lead_time_days !== undefined) {
//       rule.leadTimeDays = Number(ovRow.lead_time_days);
//     }
//   }

//   return rule;
// }

// // 単価を（valid_from / valid_toで）その日付に有効なものから拾う
// function lookupUnitPrice(vendorId: string, itemId: string, ymd: string): number {
//   const row = db.prepare(
//     `
//       SELECT unit_price AS price
//         FROM item_prices
//        WHERE vendor_id = ?
//          AND item_id   = ?
//          AND valid_from <= ?
//          AND (valid_to IS NULL OR valid_to >= ?)
//        ORDER BY valid_from DESC
//        LIMIT 1
//     `
//   ).get(vendorId, itemId, ymd, ymd) as { price?: number } | undefined;

//   return row?.price ?? 0;
// }

// // 指定 store / date における発注候補アイテム一覧を返す。
// // store_vendor_items が「この店この日このベンダーこの品目OK」を決めている前提。
// function listOrderableItems(storeId: string, ymd: string) {
//   const sql = `
//     SELECT
//       svi.item_id      AS itemId,
//       svi.vendor_id    AS vendorId,
//       i.name           AS name,
//       i.spec           AS spec,
//       i.unit           AS unit
//     FROM store_vendor_items AS svi
//     JOIN items AS i
//       ON i.id = svi.item_id
//     WHERE svi.store_id = ?
//       AND ? BETWEEN svi.valid_from AND COALESCE(svi.valid_to,'9999-12-31')
//     ORDER BY svi.item_id, svi.vendor_id
//   `;
//   const rows = db.prepare(sql).all(storeId, ymd) as {
//     itemId: string;
//     vendorId: string;
//     name: string;
//     spec: string;
//     unit: string;
//   }[];

//   // rows は 複数ベンダー×同一itemId もあり得る
//   // 単価をここで埋めて返す
//   const enriched = rows.map(r => ({
//     ...r,
//     unitPrice: lookupUnitPrice(r.vendorId, r.itemId, ymd),
//   }));

//   return enriched;
// }

// // 既存の注文（今日この店この日付で既に送信した分）があれば拾う。
// // B案方針：ordersはヘッダ vendor_id=null / vendor_mode='all' として 1日1本に集約している想定。
// // ただし念のため複数返ってきたら「一番新しいやつ」を採用。
// function loadExistingOrder(storeId: string, ymd: string) {
//   const header = db.prepare(
//     `
//       SELECT id, order_date, expected_arrival_date, subtotal, tax, total, tax_rate
//       FROM orders
//       WHERE store_id=?
//         AND order_date=?
//       ORDER BY updated_at DESC
//       LIMIT 1
//     `
//   ).get(storeId, ymd) as
//     | {
//         id: string;
//         order_date: string;
//         expected_arrival_date: string | null;
//         subtotal: number;
//         tax: number;
//         total: number;
//         tax_rate: number;
//       }
//     | undefined;

//   if (!header) {
//     return {
//       exists: false,
//       lines: [] as any[],
//       orderId: null as string | null,
//     };
//   }

//   const lines = db.prepare(
//     `
//       SELECT
//         ol.item_id            AS itemId,
//         ol.qty                AS qty,
//         ol.unit_price         AS unitPrice,
//         ol.expected_arrival_date AS expectedArrivalDate,
//         ol.vendor_id          AS vendorId
//       FROM order_lines ol
//       WHERE ol.order_id = ?
//       ORDER BY ol.id
//     `
//   ).all(header.id) as {
//     itemId: string;
//     qty: number;
//     unitPrice: number;
//     expectedArrivalDate: string | null;
//     vendorId: string | null;
//   }[];

//   // lineId はフロント用の安定キー。ここでは itemIdベースで作る。
//   const shapedLines = lines.map(l => ({
//     lineId: `ln-${l.itemId}`,
//     itemId: l.itemId,
//     qty: l.qty,
//     unitPrice: l.unitPrice ?? 0,
//     vendorId: l.vendorId ?? "",
//     expectedArrivalDate: l.expectedArrivalDate ?? null,
//   }));

//   return {
//     exists: true,
//     orderId: header.id,
//     lines: shapedLines,
//   };
// }

// // 締め/ロック判定。
// // - 今日の営業日より前なら編集不可
// // - vendor_rules_daily 上「今日の vendor は orderable=false」なら不可
// //   （ただしベンダーごとに違うので、とりあえず全ベンダー中1つでも orderable=true なら編集OK、とする）
// function decideEditable(storeId: string, ymd: string, perVendorRules: Record<string, {
//   orderable: boolean;
//   cutoffHHmm: string;
//   leadTimeDays: number;
// }>) {
//   const { businessDate } = getBusinessDate();
//   if (ymd < businessDate) {
//     return {
//       editable: false,
//       reason: "締切後のデータは変更できません。履歴画面でご確認ください。",
//     };
//   }

//   // その日1件も orderable=true がないなら不可
//   const anyOrderable = Object.values(perVendorRules).some(r => r.orderable);
//   if (!anyOrderable) {
//     return {
//       editable: false,
//       reason: "本日は発注できないベンダーのみです。",
//     };
//   }

//   // ここでは cutoffHHmm の時刻チェックまではまだしていない。
//   return {
//     editable: true,
//     reason: null,
//   };
// }

// // 既存: getBusinessDate, pickRuleForDow, loadWeeklyRuleForVendor, loadOverrideForStoreVendor などは流用

// type PerVendorRule = { orderable: boolean; cutoffHHmm: string | null; leadTimeDays: number | null };

// /** 指定日の「店×ベンダー」ルールをマップ化（anyOrderable 判定に使う） */
// function buildPerVendorRulesForDate(db: any, storeId: string, ymd: string): Record<string, PerVendorRule> {
//   // 店が扱うベンダー一覧
//   const vList = db.prepare(`
//     SELECT DISTINCT svi.vendor_id AS vendorId
//       FROM store_vendor_items svi
//      WHERE svi.store_id = ?
//   `).all(storeId) as any[];

//   const dow = getDow(ymd);
//   const result: Record<string, PerVendorRule> = {};

//   for (const v of vList) {
//     const vendorId = String(v.vendorId);
//     const base = loadWeeklyRuleForVendor(db, vendorId);
//     const ov   = loadOverrideForStoreVendor(db, storeId, vendorId);
//     if (!base && !ov) continue;

//     const day = pickRuleForDow(dow, base, ov);
//     result[vendorId] = {
//       orderable: !!day.orderable,
//       cutoffHHmm: day.cutoffHHMM ?? null,
//       leadTimeDays: day.leadTimeDays ?? null,
//     };
//   }
//   return result;
// }

// // 起動時に shipments 周りのスキーマを保証する
// function ensureShipmentsSchema(db: any) {
//   // 1) 無ければ新規作成（destination_id ベース）
//   const hasShipments = db
//     .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='shipments'")
//     .get();
//   if (!hasShipments) {
//     db.exec(`
//       CREATE TABLE IF NOT EXISTS shipments (
//         id               INTEGER PRIMARY KEY AUTOINCREMENT,
//         vendor_id        TEXT NOT NULL,
//         destination_id   TEXT NOT NULL,
//         destination_name TEXT,
//         delivery_date    TEXT NOT NULL,
//         status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','confirmed','canceled')),
//         created_at       TEXT NOT NULL DEFAULT (datetime('now')),
//         updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
//       );
//       CREATE UNIQUE INDEX IF NOT EXISTS ux_shipments_vendor_dest_date
//         ON shipments (vendor_id, destination_id, delivery_date);
//     `);
//     return;
//   }

//   // 2) 既存カラムを確認
//   const cols = db.prepare("PRAGMA table_info('shipments')").all() as Array<{name:string}>;
//   const hasStoreId = cols.some(c => c.name === 'store_id');
//   const hasDestinationId = cols.some(c => c.name === 'destination_id');
//   const hasStatus = cols.some(c => c.name === 'status');
//   const hasDestName = cols.some(c => c.name === 'destination_name');

//   // 3) 旧スキーマ（store_idあり）なら安全に再構築して移送
//   if (hasStoreId && !hasDestinationId) {
//     db.exec(`
//       PRAGMA foreign_keys = OFF;
//       BEGIN;

//       CREATE TABLE shipments_new (
//         id               INTEGER PRIMARY KEY AUTOINCREMENT,
//         vendor_id        TEXT NOT NULL,
//         destination_id   TEXT NOT NULL,
//         destination_name TEXT,
//         delivery_date    TEXT NOT NULL,
//         status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','confirmed','canceled')),
//         created_at       TEXT NOT NULL DEFAULT (datetime('now')),
//         updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
//       );

//       INSERT INTO shipments_new (id, vendor_id, destination_id, destination_name, delivery_date, status, created_at, updated_at)
//       SELECT
//         id,
//         vendor_id,
//         COALESCE(store_id,'0000'),
//         NULL,
//         delivery_date,
//         'open',
//         COALESCE(created_at, datetime('now')),
//         COALESCE(updated_at, datetime('now'))
//       FROM shipments;

//       DROP TABLE shipments;
//       ALTER TABLE shipments_new RENAME TO shipments;

//       CREATE UNIQUE INDEX IF NOT EXISTS ux_shipments_vendor_dest_date
//         ON shipments (vendor_id, destination_id, delivery_date);

//       COMMIT;
//       PRAGMA foreign_keys = ON;
//     `);
//   } else {
//     // 4) 新スキーマ寄りなら不足列/インデックスだけ整える
//     db.exec(`
//       CREATE UNIQUE INDEX IF NOT EXISTS ux_shipments_vendor_dest_date
//         ON shipments (vendor_id, destination_id, delivery_date);
//     `);
//     if (!hasStatus || !hasDestName) {
//       // 列追加が必要なときは再構築で補う（ALTER ADD COLUMN で済ませたい場合は個別に追加でもOK）
//       db.exec(`
//         PRAGMA foreign_keys = OFF;
//         BEGIN;

//         CREATE TABLE shipments_new (
//           id               INTEGER PRIMARY KEY AUTOINCREMENT,
//           vendor_id        TEXT NOT NULL,
//           destination_id   TEXT NOT NULL,
//           destination_name TEXT,
//           delivery_date    TEXT NOT NULL,
//           status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','confirmed','canceled')),
//           created_at       TEXT NOT NULL DEFAULT (datetime('now')),
//           updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
//         );

//         INSERT INTO shipments_new (id, vendor_id, destination_id, destination_name, delivery_date, status, created_at, updated_at)
//         SELECT
//           id,
//           vendor_id,
//           destination_id,
//           /* 既存に列がなければ NULL を入れる */
//           (SELECT CASE WHEN EXISTS(SELECT 1 FROM pragma_table_info('shipments') WHERE name='destination_name') THEN destination_name ELSE NULL END),
//           delivery_date,
//           (SELECT CASE WHEN EXISTS(SELECT 1 FROM pragma_table_info('shipments') WHERE name='status') THEN status ELSE 'open' END),
//           created_at,
//           updated_at
//         FROM shipments;

//         DROP TABLE shipments;
//         ALTER TABLE shipments_new RENAME TO shipments;

//         CREATE UNIQUE INDEX IF NOT EXISTS ux_shipments_vendor_dest_date
//           ON shipments (vendor_id, destination_id, delivery_date);

//         COMMIT;
//         PRAGMA foreign_keys = ON;
//       `);
//     }
//   }
// }

// // 集計結果の型（SELECT の列に合わせる）
// type ShipmentAggRow = {
//   vendor_id: string;
//   delivery_date: string;   // 'YYYY-MM-DD'
//   item_id: string;
//   qty: number;
//   unit_price: number;
//   amount: number;
// };

// // DBのクエリを安全に呼ぶためのラッパー（失敗しても throw させずログに出して無害な値を返す）
// function safeGetAll<T = any>(label: string, sql: string, params: any[] = [], fallback: T[] = []): T[] {
//   try {
//     return db.prepare(sql).all(...params) as T[];
//   } catch (e) {
//     console.error(`[safeGetAll:${label}]`, e);
//     return fallback;
//   }
// }

// function safeGetOne<T = any>(label: string, sql: string, params: any[] = [], fallback: T | undefined = undefined): T | undefined {
//   try {
//     return db.prepare(sql).get(...params) as T | undefined;
//   } catch (e) {
//     console.error(`[safeGetOne:${label}]`, e);
//     return fallback;
//   }
// }

// // ====== Config ======
// const PORT = Number(process.env.PORT || 8080);
// // const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "db", "data.sqlite"); // お使いのパスに合わせてOK
// const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "..", "db", "data.sqlite");
// // ====== App / DB ======
// const app = express();
// app.use(cors());
// app.use(express.json({ limit: "2mb" }));
// app.get('/__tables', (_req, res) => {
//   const rows = db.prepare(`
//     SELECT type, name FROM sqlite_master
//     WHERE type IN ('table','index')
//     ORDER BY type, name
//   `).all();
//   res.json({ rows });
// });

// // 先頭はエラーになる
// console.log("[server] booting file =", __filename);

// app.get("/__whoami", (_req, res) => {
//   res.json({ file: __filename, now: new Date().toISOString() });
// });

// ========================
// ルート本体
// ========================
app.get("/ordering/rules", (req: any, res: any) => {
  const storeId = String(req.query.storeId || "").trim();
  const orderDate = String(req.query.orderDate || "").trim(); // "YYYY-MM-DD"

  // 1) 入力チェック
  if (!storeId || !orderDate || !/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) {
    return res.status(400).json({ error: "invalid params" });
  }

  // 2) 店舗の存在/有効性チェック
  const storeRow = db
    .prepare(
      `
    SELECT store_id, store_name, is_active
    FROM stores
    WHERE store_id = ? AND is_active = 1
  `
    )
    .get(storeId);

  if (!storeRow) {
    return res.status(404).json({ error: "store not found or inactive" });
  }


// 3) この店舗が扱っているベンダー一覧 -------------
  // ！！ここを置き換え！！
  const vendorRowsRaw = db
    .prepare(
      `
      SELECT DISTINCT
        svi.vendor_id   AS vendorId,
        v.vendor_name   AS vendorName
      FROM store_vendor_items svi
      JOIN vendors v ON v.vendor_id = svi.vendor_id
      WHERE svi.store_id = ?
    `
    )
    .all(storeId) as unknown;

  // unknown -> 型安全な配列へマッピング（ここで型を確定させる）
  const vendorRows: VendorRow[] = Array.isArray(vendorRowsRaw)
    ? (vendorRowsRaw as any[]).map((r) => ({
        vendorId: String(r.vendorId),
        vendorName: String(r.vendorName),
      }))
    : [];

  // 4) 判定処理 ---------------------------------------
  const dow = getDow(orderDate); // 0=Sun..6=Sat

  const vendorsResult: VendorRuleResult[] = [];

  let anyOrderable = false;
  let allClosed = true;
  let earliestCutoff: string | null = null;

  for (const vRow of vendorRows) {
    const { vendorId, vendorName } = vRow;

    const baseRule = loadWeeklyRuleForVendor(db, vendorId);
    const overrideRule = loadOverrideForStoreVendor(db, storeId, vendorId);

    if (!baseRule && !overrideRule) {
      vendorsResult.push({
        vendorId,
        vendorName,
        orderable: false,
        isClosed: true,
        cutoffTime: null,
        leadTimeDays: null,
        deliveryDate: null,
        notes: "ルール未設定",
      });
      continue;
    }

    const dayRule = pickRuleForDow(dow, baseRule, overrideRule);
    const closed = !dayRule.orderable || isClosedNow(orderDate, dayRule.cutoffHHMM);

    if (dayRule.orderable) anyOrderable = true;
    if (!closed)          allClosed   = false;

    if (dayRule.orderable && dayRule.cutoffHHMM) {
      if (!earliestCutoff || dayRule.cutoffHHMM < earliestCutoff) {
        earliestCutoff = dayRule.cutoffHHMM;
      }
    }

    const deliveryDate = calcDeliveryDate(orderDate, dayRule.leadTimeDays);

    vendorsResult.push({
      vendorId,
      vendorName,
      orderable: dayRule.orderable,
      isClosed: closed,
      cutoffTime: dayRule.cutoffHHMM,
      leadTimeDays: dayRule.leadTimeDays,
      deliveryDate,
      notes: dayRule.note ?? null,
    });
  }

  const summary: RulesSummary = {
    anyOrderable,
    allClosed,
    earliestCutoffTime: earliestCutoff,
    statusText: buildStatusText(anyOrderable, allClosed),
  };

  const body: RulesResponse = {
    storeId,
    orderDate,
    cutoffCheckedAt: new Date().toISOString(), // 必要ならJST整形にして良い
    vendors: vendorsResult,
    summary,
  };

  return res.json(body);
});
// ensureShipmentsSchema();
// --- 診断用: ヘルスチェック ---
app.get('/__ping', (_req, res) => res.json({ ok: true }));

// --- 診断用: 登録済みルートを一覧表示 ---
app.get('/__routes', (_req, res) => {
  // @ts-ignore
  const stack = app._router?.stack ?? [];
  const routes = stack
    .filter((l: any) => l.route)
    .map((l: any) => {
      const methods = Object.keys(l.route.methods)
        .filter((m) => l.route.methods[m])
        .map((m) => m.toUpperCase())
        .join(',');
      return `${methods} ${l.route.path}`;
    });
  res.json({ routes });
});

app.get("/history/search", (req, res) => {
  const { storeId, from, to } = req.query as { storeId?: string; from?: string; to?: string };

  // 既存: rows を取ってくる（例）
  const rows = db.prepare(`
    SELECT
      o.id            AS orderId,
      o.store_id      AS storeId,
      o.order_date    AS orderDate,
      o.total         AS totalAmount,
      o.created_at    AS createdAt
    FROM "order" o
    WHERE (? IS NULL OR o.store_id = ?)
      AND (? IS NULL OR o.order_date >= ?)
      AND (? IS NULL OR o.order_date <= ?)
    ORDER BY o.order_date DESC, o.id DESC
  `).all(
    storeId ?? null, storeId ?? null,
    from ?? null,     from ?? null,
    to ?? null,       to ?? null
  ) as any[];

  const out = rows.map((r) => {
    const perVendorRulesRaw = buildPerVendorRulesForDate(db, String(r.storeId), String(r.orderDate));
    const perVendorRulesForDecide: Record<string, { orderable: boolean; cutoffHHmm: string; leadTimeDays: number; }> =
      Object.fromEntries(
        Object.entries(perVendorRulesRaw).map(([vid, v]) => [
          vid,
          {
            orderable: !!v.orderable,
            cutoffHHmm: v.cutoffHHmm ?? "",
            leadTimeDays: v.leadTimeDays ?? 0,
          }
        ])
      );

    const st = decideEditable(String(r.storeId), String(r.orderDate), perVendorRulesForDecide);

    return {
      ...r,
      status: {
        editable: !!st.editable,
        reason: st.reason ?? "",
      },
    };
  });

  res.json({ rows: out });
});


// 既にルータにまとめている場合は basePath を確認:
// 例) app.use('/api', router) があるなら、下のパスは '/api/shipments/generate' になります。

const db = new Database(DB_PATH, { fileMustExist: true });
ensureShipmentsSchema(db);

// ====== Utils ======
// --- helper: table existence ---
function hasTable(name: string): boolean {
  try {
    // sqlite_master を見るのが手軽で高速
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name) as { name?: string } | undefined;
    return !!row?.name;
  } catch {
    return false;
  }
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

const parseHM = (hhmm: string) => {
  const [h, m] = (hhmm || "04:00").split(":").map((n) => Number(n));
  return { h: Number.isFinite(h) ? h : 4, m: Number.isFinite(m) ? m : 0 };
};

/** 営業日付を返す（とりあえず現時点のローカル日付ベース） */
// function getBusinessDate(): { businessDate: string } {
//   // 現在日時を JST に補正
//   const now = new Date();
//   const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000); // UTC→JST補正
//   const today = ymd(jst); // 既存の ymd() を利用して "YYYY-MM-DD" 形式に

//   // 今後、締め時刻（04:00）を考慮する場合はここに条件追加
//   // 例:
//   // if (jst.getHours() < 4) { ...前日扱いにする... }

//   return { businessDate: today };
// }

/** “営業日翌日の HH:mm が締め” として締め日時を作る */
function computeCutoffDate(orderDate: string, hhmm: string) {
  const d = new Date(orderDate + "T00:00:00");
  d.setDate(d.getDate() + 1);
  const { h, m } = parseHM(hhmm);
  d.setHours(h, m, 0, 0);
  return d;
}

function isOrderableNow(orderDate: string, cutoffHHmm: string) {
  const cutoff = computeCutoffDate(orderDate, cutoffHHmm);
  return new Date() <= cutoff;
}

// --- DEBUG: 実DBの item_prices の列名確認 ---検証用
app.get("/_debug/item_prices_columns", (_req, res) => {
  const cols = db.prepare("PRAGMA table_info(item_prices)").all();
  res.json(cols.map((c: any) => c.name));
});

// === Add near other utils ===
const onlyDigits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const pad = (s: string, w: number) => s.padStart(w, "0");
const ID = {
  store: (s: unknown) => pad(onlyDigits(s), 4),   // 0001
  item:  (s: unknown) => pad(onlyDigits(s), 6),   // 000001
  vendor:(s: unknown) => pad(onlyDigits(s), 6),   // 000101
};

// inbound query/body 正規化ヘルパ
function normalizeOrderingKey(q: any) {
  return {
    storeId: q.storeId ? ID.store(q.storeId) : undefined,
    vendorMode: q.vendorMode as "all" | "single" | undefined,
    vendorId: q.vendorId ? ID.vendor(q.vendorId) : undefined,
    orderDate: q.orderDate as string | undefined,
  };
}

// ====== Rule / Price resolvers ======

/** 曜日 0..6（日..土） */
function weekdayOf(dateStr: string) {
  return new Date(dateStr + "T00:00:00").getDay();
}

/**
 * 店舗×ベンダー×曜日の最終ルールを解決
 * - store_vendor_overrides が優先
 * - なければ vendor_weekly_rules
 * - 欠損は デフォルト { orderable:1, cutoff:"04:00", lead:1 }
 */
function resolveRule(storeId: string, vendorId: string, orderDate: string) {
  const w = weekdayOf(orderDate);

  const ov = db
    .prepare(
      `SELECT orderable,
              cutoff_hhmm   AS cutoffHHmm,
              lead_time_days AS leadTimeDays
         FROM store_vendor_overrides
        WHERE store_id=? AND vendor_id=? AND weekday=?`
    )
    .get(storeId, vendorId, w) as
    | { orderable: number | null; cutoffHHmm: string | null; leadTimeDays: number | null }
    | undefined;

  const base = db
    .prepare(
      `SELECT orderable,
              cutoff_hhmm   AS cutoffHHmm,
              lead_time_days AS leadTimeDays
         FROM vendor_weekly_rules
        WHERE vendor_id=? AND weekday=?`
    )
    .get(vendorId, w) as
    | { orderable: number | null; cutoffHHmm: string | null; leadTimeDays: number | null }
    | undefined;

  const orderable = (ov?.orderable ?? base?.orderable ?? 1) === 1;
  const cutoffHHmm = ov?.cutoffHHmm ?? base?.cutoffHHmm ?? "04:00";
  const leadTimeDays = ov?.leadTimeDays ?? base?.leadTimeDays ?? 1;

  return { orderable, cutoffHHmm, leadTimeDays };
}

// --- アイテムのベンダ解決（vendorMode=all 用）：VENDOR_COL を使用 ---
function vendorForItem(itemId: string, dateYmd: string): string | null {
  const sql = `
    SELECT ${VENDOR_COL} AS vendorId
      FROM item_prices
     WHERE item_id = ?
       AND valid_from <= ?
       AND (valid_to IS NULL OR valid_to >= ?)
     ORDER BY valid_from DESC
     LIMIT 1
  `;
  const row = db.prepare(sql).get(itemId, dateYmd, dateYmd) as { vendorId?: string } | undefined;
  return row?.vendorId ?? null;
}

/** 単価（有効期間内の最新） */
// --- 価格取得：VENDOR_COL を使用 ---
function unitPriceFor(vendorId: string, itemId: string, date: string): number | null {
  const sql = `
    SELECT unit_price AS price
      FROM item_prices
     WHERE ${VENDOR_COL} = ?
       AND item_id = ?
       AND valid_from <= ?
       AND (valid_to IS NULL OR valid_to >= ?)
     ORDER BY valid_from DESC
     LIMIT 1
  `;
  const row = db.prepare(sql).get(vendorId, itemId, date, date) as { price?: number } | undefined;
  return row?.price ?? null;
}

// --- 追加：item_prices のベンダ列名を自動判定（vendor_id or vendor） ---
function detectVendorColumn(): "vendor_id" | "vendor" {
  const cols = db.prepare("PRAGMA table_info(item_prices)").all() as { name: string }[];
  if (cols.some(c => c.name === "vendor_id")) return "vendor_id";
  if (cols.some(c => c.name === "vendor")) return "vendor";
  throw new Error("item_prices に vendor_id / vendor 列が見つかりません");
}
const VENDOR_COL = detectVendorColumn(); // ← 以降ここを参照

// ====== Endpoints ======

app.get("/health", (_req, res) => res.json({ ok: true, now: new Date().toISOString() }));


// 古い /items も使わないので、互換だけ残す
app.get("/items", (req: express.Request, res: express.Response) => {
  res.json({
    items: [],
    note: "deprecated endpoint",
  });
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

// GET /stores  — stores があれば優先。無ければ store_vendor_overrides から推定
app.get("/stores", (_req, res) => {
  try {
    let rows: any[] = [];

    if (hasTable("stores")) {
      rows = db.prepare(
        `SELECT id, COALESCE(code, id) AS code, COALESCE(name, id) AS name
           FROM stores
          ORDER BY id`
      ).all();
    } else if (hasTable("store_vendor_overrides")) {
      rows = db.prepare(
        `SELECT DISTINCT store_id AS id,
                store_id              AS code,
                store_id              AS name
           FROM store_vendor_overrides
          ORDER BY store_id`
      ).all();
    } else {
      rows = [];
    }

    res.json({ stores: rows });
  } catch (e: any) {
    console.error("[/stores] error:", e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});


// GET /vendors  — vendors テーブルがあればそれを返す。無ければ item_prices から推定
app.get("/vendors", (_req, res) => {
  try {
    let rows: any[] = [];

    if (hasTable("vendors")) {
      rows = db
        .prepare(
          `SELECT id, COALESCE(name, id) AS name
             FROM vendors
            ORDER BY id`
        )
        .all();
    } else if (hasTable("item_prices")) {
      rows = db
        .prepare(
          `SELECT DISTINCT vendor_id AS id, vendor_id AS name
             FROM item_prices
            ORDER BY vendor_id`
        )
        .all();
    } else {
      rows = [];
    }

    res.json({ vendors: rows });
  } catch (e: any) {
    console.error("[/vendors] error:", e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// GET /pricing?vendorId=VND01&itemId=000001&orderDate=2025-10-17
app.get("/pricing", (req, res) => {
  const vendorId = String(req.query.vendorId || "");
  const itemId   = String(req.query.itemId   || "");
  const orderDate = String(req.query.orderDate || req.query.date || "");

  if (!vendorId || !itemId || !orderDate) {
    return res.status(400).json({ error: "vendorId, itemId, orderDate are required" });
  }

  try {
    const row = db.prepare(
      `SELECT unit_price AS price
         FROM item_prices
        WHERE vendor_id=? AND item_id=? AND valid_from<=?
          AND (valid_to IS NULL OR valid_to>=?)
        ORDER BY valid_from DESC
        LIMIT 1`
    ).get(vendorId, itemId, orderDate, orderDate) as { price?: number } | undefined;

    res.json({ unitPrice: row?.price ?? null });
  } catch (e: any) {
    console.error("[/pricing] error:", e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// 既存 /pricing の下あたりに追加（エイリアス）
app.get("/pricing/resolve", (req, res) => {
  // クライアントは date=YYYY-MM-DD（or ISO）で送ってくる
  const vendorId = String(req.query.vendorId || "");
  const itemId   = String(req.query.itemId   || "");
  const rawDate  = String(req.query.date || "");
  const orderDate = rawDate ? String(rawDate).slice(0, 10) : ""; // YYYY-MM-DD に丸め

  if (!vendorId || !itemId || !orderDate) {
    return res.status(400).json({ error: "vendorId, itemId, date are required" });
  }

  try {
    const row = db.prepare(
      `SELECT unit_price AS price
         FROM item_prices
        WHERE vendor_id=? AND item_id=? AND valid_from<=?
          AND (valid_to IS NULL OR valid_to>=?)
        ORDER BY valid_from DESC
        LIMIT 1`
    ).get(vendorId, itemId, orderDate, orderDate) as { price?: number } | undefined;

    // フロントの型に合わせて { unitPrice } で返す
    res.json({ unitPrice: row?.price ?? 0 });
  } catch (e: any) {
    console.error("[/pricing/resolve] error:", e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// 古いドラフト復元APIは使わないのでダミー返却にする
app.get("/ordering/draft", (req: express.Request, res: express.Response) => {
  res.json({
    exists: false,
    lines: [],
    note: "deprecated endpoint",
  });
});

app.get("/ordering/list", (req, res) => {
  const { storeId, from, start, to, end } = req.query as any;
  const qFrom = from ?? start ?? null;
  const qTo   = to   ?? end   ?? null;

  // 行数集計のサブクエリ
  const rows = db.prepare(`
    SELECT
      o.id           AS id,
      o.store_id     AS storeId,
      o.vendor_id    AS vendorId,
      o.order_date   AS orderDate,
      COALESCE(x.lineCount, 0) AS lineCount,
      o.total        AS total
    FROM orders o
    LEFT JOIN (
      SELECT ol.order_id AS orderId, COUNT(*) AS lineCount
      FROM order_lines ol
      GROUP BY ol.order_id
    ) x ON x.orderId = o.id
    WHERE (? IS NULL OR o.store_id = ?)
      AND (? IS NULL OR o.order_date >= ?)
      AND (? IS NULL OR o.order_date <= ?)
    ORDER BY o.order_date DESC, o.id DESC
  `).all(
    storeId ?? null, storeId ?? null,
    qFrom ?? null, qFrom ?? null,
    qTo ?? null,   qTo ?? null
  );

  // 件数と合計の要約
  const summary = rows.reduce(
    (acc: { total: number; count: number }, r: any) => {
      acc.total += Number(r.total || 0);
      acc.count += 1;
      return acc;
    },
    { total: 0, count: 0 }
  );

  res.json({ total: rows.length, items: rows, summary });
});

app.get("/ordering/detail", (req, res) => {
  const { orderId } = req.query as any;
  if (!orderId) return res.status(400).json({ error: "orderId is required" });

  const header = db.prepare(`
    SELECT
      o.id                 AS id,
      o.store_id           AS storeId,
      o.vendor_id          AS vendorId,
      o.order_date         AS orderDate,
      o.expected_arrival_date AS expectedArrivalDate,
      o.subtotal           AS subtotal,
      o.tax                AS tax,
      o.total              AS total
    FROM orders o
    WHERE o.id = ?
  `).get(orderId);

  if (!header) return res.json({ header: null, lines: [] });

  const lines = db.prepare(`
    SELECT
      ol.item_id     AS itemId,
      i.name         AS itemName,
      ol.qty         AS qty,
      ol.unit_price  AS unitPrice,
      ol.amount      AS amount
    FROM order_lines ol
    LEFT JOIN items i ON i.id = ol.item_id
    WHERE ol.order_id = ?
    ORDER BY ol.id
  `).all(orderId);

  res.json({ header, lines });
});

app.get("/ordering/export_lines", (req, res) => {
  const { storeId, from, start, to, end } = req.query as any;
  const qFrom = from ?? start ?? null;
  const qTo   = to   ?? end   ?? null;

  const rows = db.prepare(`
    SELECT
      o.id           AS orderId,
      o.store_id     AS storeId,
      s.name         AS storeName,
      o.vendor_id    AS vendorId,
      v.name         AS vendorName,
      o.order_date   AS orderDate,
      ol.item_id     AS itemId,
      i.name         AS itemName,
      ol.qty         AS qty,
      ol.unit_price  AS unitPrice,
      ol.amount      AS amount
    FROM orders o
    JOIN order_lines ol ON ol.order_id = o.id
    LEFT JOIN stores  s ON s.id = o.store_id
    LEFT JOIN vendors v ON v.id = o.vendor_id
    LEFT JOIN items   i ON i.id = ol.item_id
    WHERE (? IS NULL OR o.store_id = ?)
      AND (? IS NULL OR o.order_date >= ?)
      AND (? IS NULL OR o.order_date <= ?)
    ORDER BY o.order_date DESC, o.id DESC, ol.id
  `).all(
    storeId ?? null, storeId ?? null,
    qFrom ?? null,   qFrom ?? null,
    qTo ?? null,     qTo ?? null
  );

  res.json({ items: rows });
});

app.post("/pricing/bulk", (req, res) => {
  const { vendorId, orderDate, itemIds } = req.body || {};
  if (!vendorId || !orderDate || !Array.isArray(itemIds)) {
    return res.status(400).json({ error: "vendorId, orderDate, itemIds are required" });
  }
  try {
    const stmt = db.prepare(
      `SELECT item_id AS itemId, unit_price AS price
         FROM item_prices
        WHERE vendor_id=? AND item_id IN (${itemIds.map(() => "?").join(",")})
          AND valid_from<=? AND (valid_to IS NULL OR valid_to>=?)
        ORDER BY valid_from DESC`
    );
    const rows = stmt.all(vendorId, ...itemIds, orderDate, orderDate) as Array<{itemId:string; price:number}>;
    const map: Record<string, number|null> = Object.fromEntries(itemIds.map(id => [id, null]));
    for (const r of rows) if (map[r.itemId] == null) map[r.itemId] = r.price; // 最新優先
    res.json({ prices: map });
  } catch (e: any) {
    console.error("[/pricing/bulk] error:", e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// 受注入力画面 初期化／再検索用
app.get("/ordering/entry", (req, res) => {
  try {
    const storeId = String(req.query.storeId || "").trim();
    const orderDate = String(req.query.orderDate || "").trim(); // YYYY-MM-DD
    if (!storeId || !orderDate) {
      return res.status(400).json({ error: "storeId and orderDate required" });
    }

    // 1) 営業日/曜日を決定
    const businessDate = orderDate;
    const weekday = weekdayFromYmd(businessDate); // 0=Sun ... 6=Sat

    // 2) アクティブ店舗一覧（is_active=1 のみ）
    const stores = db.prepare(`
      SELECT id, name
      FROM stores
      WHERE is_active = 1
      ORDER BY id
    `).all() as { id: string; name: string }[];

    // 3) この店舗でこの日に発注候補になるベンダーを一覧化
    //
    //   store_vendor_items: 店舗ごとに「どの vendor_id のどの item_id が使えるか」
    //   vendor_weekly_rules: ベンダーごとの曜日ルール
    //   store_vendor_overrides: 店舗×ベンダーでの上書き（曜日別のoverride_*_sun 等）
    //
    //   ※ valid_from / valid_to で「その日も採用中か」を判定
    //
    const vendorCandidates = db.prepare(`
      SELECT DISTINCT svi.vendor_id AS vendor_id
      FROM store_vendor_items svi
      WHERE svi.store_id = ?
        AND svi.valid_from <= ?
        AND (svi.valid_to IS NULL OR svi.valid_to >= ?)
      ORDER BY svi.vendor_id
    `).all(storeId, businessDate, businessDate) as { vendor_id: string }[];

    // activeVendors に {id,name} を作る
    // vendors マスタから名前を取る
    const activeVendors = vendorCandidates.map(v => {
      const row = db.prepare(`
        SELECT id, name FROM vendors WHERE id = ?
      `).get(v.vendor_id) as { id: string; name: string } | undefined;
      return row || { id: v.vendor_id, name: v.vendor_id };
    });

    // 4) ベンダーごとのルールを weekday 単位で解決
    //
    //    vendor_weekly_rules は全店共通の「標準ルール(曜日別)」
    //    store_vendor_overrides は店別の上書き(同じく曜日別overrideカラム)
    //
    //    例：
    //      - weekly_rules.orderable_mon
    //      - override.orderable_mon_override
    //    のように、曜日インデックスに応じて動的に読む
    //
    function pickRuleForStoreAndVendor(storeId: string, vendorId: string, weekday: number) {
      // まず標準ルール
      const wr = db.prepare(`
        SELECT *
        FROM vendor_weekly_rules
        WHERE vendor_id = ?
      `).get(vendorId) as any || {};

      // 店舗別オーバーライド（行が無い場合もある）
      const ov = db.prepare(`
        SELECT *
        FROM store_vendor_overrides
        WHERE store_id = ?
          AND vendor_id = ?
      `).get(storeId, vendorId) as any || {};

      // 曜日ごとのカラム名を決める
      const dayKeys = [
        "sun","mon","tue","wed","thu","fri","sat"
      ];
      const key = dayKeys[weekday]; // 'sun' | 'mon' | ...

      // ベース値（標準）
      const base_orderable      = wr[`orderable_${key}`];
      const base_cutoff         = wr[`cutoff_hhmm_${key}`];
      const base_lead_time_days = wr[`lead_time_days_${key}`];

      // オーバーライド（NULLでなければ上書き）
      const ov_orderable      = ov[`orderable_${key}_override`];
      const ov_cutoff         = ov[`cutoff_hhmm_${key}_override`];
      const ov_lead_time_days = ov[`lead_time_days_${key}_override`];

      const orderable = (ov_orderable !== null && ov_orderable !== undefined)
        ? ov_orderable
        : base_orderable;
      const cutoffHHmm = (ov_cutoff !== null && ov_cutoff !== undefined && ov_cutoff !== "")
        ? ov_cutoff
        : base_cutoff;
      const leadTimeDays = (ov_lead_time_days !== null && ov_lead_time_days !== undefined)
        ? ov_lead_time_days
        : base_lead_time_days;

      return {
        orderable: !!orderable && Number(orderable) !== 0,
        cutoffHHmm: cutoffHHmm || "04:00",
        leadTimeDays: (leadTimeDays ?? 1)
      };
    }

    // perVendorRule を組み立て
    const perVendorRule: Record<string, { orderable: boolean; cutoffHHmm: string; leadTimeDays: number }> = {};
    for (const v of activeVendors) {
      perVendorRule[v.id] = pickRuleForStoreAndVendor(storeId, v.id, weekday);
    }

    // 5) 今日この店で実際に発注可能なベンダーだけを抽出
    //    （=曜日ルールで orderable=true のもの）
    const orderableVendorIds = activeVendors
      .filter(v => perVendorRule[v.id]?.orderable)
      .map(v => v.id);

    // 6) その発注可能ベンダーがこの店舗に供給する品目を、価格つきで取得
    //
    //    - store_vendor_items でその日有効な item_id を取る
    //    - item_prices でその日有効な単価を取る（valid_from/valid_to 帯域）
    //
    //    メモ: 「valid_from <= 日付 <= valid_to or NULL」を満たす最新価格を1つに絞りたい。
    //          今回は“その日適用されている価格の中で valid_from が一番新しいもの”を選びたいので、
    //          サブクエリで MAX(valid_from) を取ってから join する形にします。
    //
    // まずは店舗×ベンダー×品目（その日有効）を全部出す
    const itemsRowsRaw = db.prepare(`
      SELECT
        svi.vendor_id  AS vendor_id,
        svi.item_id    AS item_id,
        i.name         AS name,
        i.spec         AS spec,
        i.unit         AS unit
      FROM store_vendor_items svi
      JOIN items i ON i.id = svi.item_id
      WHERE svi.store_id = ?
        AND svi.valid_from <= ?
        AND (svi.valid_to IS NULL OR svi.valid_to >= ?)
      ORDER BY svi.vendor_id, svi.item_id
    `).all(storeId, businessDate, businessDate) as {
      vendor_id: string;
      item_id: string;
      name: string;
      spec: string;
      unit: string;
    }[];

    // 価格を引っ張るための helper: (vendor,item) -> unit_price
    function pickUnitPrice(vendorId: string, itemId: string, ymdDate: string): number | null {
      // その日有効なレコードのうち、もっとも新しい valid_from を選ぶ
      const row = db.prepare(`
        SELECT p.unit_price AS price
        FROM item_prices p
        WHERE p.vendor_id = ?
          AND p.item_id   = ?
          AND p.valid_from <= ?
          AND (p.valid_to IS NULL OR p.valid_to >= ?)
        ORDER BY p.valid_from DESC
        LIMIT 1
      `).get(vendorId, itemId, ymdDate, ymdDate) as { price?: number } | undefined;
      if (!row || row.price === undefined || row.price === null) return null;
      return Number(row.price);
    }

    // itemsRowsRaw を vendor で絞る（曜日上 orderable なものだけ）
    const filteredByVendorRule = itemsRowsRaw.filter(r => orderableVendorIds.includes(r.vendor_id));

    // 7) 既存のドラフト(order status=draft相当)や確定済み注文（orders/order_lines）を引いて、
    //    数量・希望納品日をマージ
    //
    // 7-1) 既存注文ヘッダを探す（B案: vendor_mode は常に 'all', vendor_id は NULL）
    const existingOrderHeader = db.prepare(`
      SELECT *
      FROM orders
      WHERE store_id = ?
        AND vendor_mode = 'all'
        AND vendor_id IS NULL
        AND order_date = ?
      LIMIT 1
    `).get(storeId, businessDate) as any || null;

    // 7-2) 既存の明細をマップ化 item_id -> { qty, expected_arrival_date }
    const existingLinesMap: Record<string, { qty: number; expectedArrivalDate: string | null }> = {};
    if (existingOrderHeader) {
      const exLines = db.prepare(`
        SELECT item_id, qty, expected_arrival_date
        FROM order_lines
        WHERE order_id = ?
      `).all(existingOrderHeader.id) as {
        item_id: string;
        qty: number;
        expected_arrival_date: string | null;
      }[];

      for (const ln of exLines) {
        existingLinesMap[ln.item_id] = {
          qty: ln.qty,
          expectedArrivalDate: ln.expected_arrival_date
        };
      }
    }

    // 7-3) 画面に返す行を構築
    //      すべての(店舗にとって本日発注可能な)品目をベースにしつつ、
    //      既存の数量/納品日があればそれを上書き。
    const mergedLines: {
      lineId: string;
      itemId: string;
      qty: number;
      unitPrice: number;
      vendorId: string;
      expectedArrivalDate: string | null;
    }[] = [];

    for (const r of filteredByVendorRule) {
      const up = pickUnitPrice(r.vendor_id, r.item_id, businessDate);
      const fallback = existingLinesMap[r.item_id];
      mergedLines.push({
        lineId: `ln-${r.item_id}`,
        itemId: r.item_id,
        qty: fallback ? fallback.qty : 0,
        unitPrice: up ?? 0,
        vendorId: r.vendor_id,
        expectedArrivalDate: fallback ? fallback.expectedArrivalDate : null
      });
    }

    // 8) 画面側ステータスと説明
    //    editable = orderableVendorIds が1件以上 && その vendor の cutoff まだ過ぎてない 等を
    //    将来的に入れるが、今は「候補ベンダーいないなら false」にとどめる
    let editable = true;
    let reason = "";
    if (orderableVendorIds.length === 0) {
      editable = false;
      reason = "本日は発注できないベンダーのみです。";
    }

    // 8.5) CSV用の名称マップ（既存データから作る：追加のSQLは不要）
    // 店舗名：stores（is_active=1 の全店）から自店を引く
    const storeName =
      (stores.find(s => s.id === storeId)?.name) ?? "";
    
    // ベンダー名：activeVendors（id/name済）からマップ化
    const vendorNames: Record<string, string> =
      Object.fromEntries(activeVendors.map(v => [v.id, v.name ?? ""]));
    
    // 品目名：itemsRowsRaw から item_id -> name をマップ化
    const itemNames: Record<string, string> = {};
    for (const r of itemsRowsRaw) {
      if (r.item_id && itemNames[r.item_id] == null) {
        itemNames[r.item_id] = r.name ?? "";
      }
    }

    // 9) レスポンス
    return res.json({
      stores, // [{id,name}, ...] is_active=1のみ
      vendors: activeVendors, // [{id,name}, ...] （＝この店舗に紐づく候補ベンダー）
      rules: {
        selected: null,       // 旧UIとの互換：特定ベンダーの現在ルール
        perVendor: perVendorRule // { vendorId: { orderable, cutoffHHmm, leadTimeDays }, ... }
      },
      items: mergedLines.map(m => ({
        itemId: m.itemId,
        name: itemsRowsRaw.find(ir => ir.item_id === m.itemId)?.name ?? m.itemId,
        spec: itemsRowsRaw.find(ir => ir.item_id === m.itemId)?.spec ?? "",
        unit: itemsRowsRaw.find(ir => ir.item_id === m.itemId)?.unit ?? "",
        vendorId: m.vendorId,
        unitPrice: m.unitPrice
      })),
      draft: {
        exists: !!existingOrderHeader,
        lines: mergedLines
      },
      order: {
        exists: !!existingOrderHeader,
        lines: mergedLines
      },
      status: {
        editable,
        reason
      },
      storeName,     // 例: "大阪駅前店"
      vendorNames,   // 例: { "600501": "青果ベンダーA", ... }
      itemNames
    });

  } catch (err) {
    console.error("[/ordering/entry] failed:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /ordering/submit
 *  - フロントの handleSend() が送る dto を受ける
 *  - 価格はサーバで再決定、金額を再計算
 *  - vendorMode=single のときのみ締め/曜日チェックを強制
 */
app.post("/ordering/submit", (req, res) => {
  // type LineIn = { itemId: string; qty: number; unitPrice?: number };
  type LineIn = { itemId: string; qty: number; unitPrice?: number; vendorId?: string };
  type Dto = {
    storeId: string;
    vendorMode: "all" | "single";
    vendorId: string | null;
    orderDate: string; // YYYY-MM-DD
    expectedArrivalDate?: string | null;
    taxRate?: number;
    lines: LineIn[];
  };

  const body = req.body || {};
  const normalized = {
    storeId: ID.store(body.storeId),
    vendorMode: body.vendorMode as "all" | "single",
    vendorId: body.vendorMode === "single" && body.vendorId ? ID.vendor(body.vendorId) : null,
    orderDate: String(body.requestDate), // 既存名が requestDate ならここで統一
    expectedArrivalDate: body.expectedArrivalDate ? String(body.expectedArrivalDate) : null,
    taxRate: Number(body.totals?.taxRate ?? body.taxRate ?? 0.1),
    lines: Array.isArray(body.lines)
      ? body.lines.map((l: any) => ({
          itemId: ID.item(l.itemId),
          qty: Number(l.qty || 0),
          unitPrice: Number(l.unitPrice ?? 0),
          amount: Number(l.amount ?? (Number(l.qty || 0) * Number(l.unitPrice || 0))),
          expectedArrivalDate: l.expectedArrivalDate ?? null,
        }))
      : [],
  };

  const b = req.body as Dto;
  const errors: string[] = [];

  // まず lines を正規化（qtyが整数かつ1以上のみ採用）
  const rawLines = Array.isArray(b?.lines) ? b.lines : [];
  const lines = rawLines.filter(ln => Number.isInteger(ln?.qty) && ln.qty > 0);

  if (!b?.storeId) errors.push("storeId は必須です。");
  if (!b?.orderDate) errors.push("orderDate は必須です。");
  if (!Array.isArray(b?.lines) || b.lines.length === 0) errors.push("lines は1件以上が必要です。");
  if (b.vendorMode === "single" && !b.vendorId) errors.push("vendorMode='single' の場合 vendorId は必須です。");

  (b.lines || []).forEach((ln, i) => {
    if (!ln?.itemId) errors.push(`lines[${i}].itemId がありません。`);
    if (!Number.isInteger(ln?.qty) || ln.qty <= 0) errors.push(`lines[${i}].qty は 1 以上の整数です。`);
  });

  if (errors.length) return res.status(400).json({ status: "error", errors });

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

  const taxRate = typeof b.taxRate === "number" ? b.taxRate : 0.1;
  let subtotal = 0;

  const normalizedLines = lines.map((ln) => {
    // vendorMode=single → その vendorId、all → アイテムの標準ベンダー
    const vId = (ln.vendorId && ln.vendorId.trim())
     ? ln.vendorId.trim()
     : (b.vendorId || vendorForItem(ln.itemId, b.orderDate));
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
    lines: normalizedLines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitPrice: l.unitPrice, vendorId: l.vendorId })),
    subtotal,
    tax,
    total,
  };
  const hash = crypto.createHash("sha256").update(JSON.stringify(key)).digest("hex");
  const orderId = `O${ymd(new Date())}-${hash.slice(0, 8)}`;

  // --- 永続化（orders / order_lines） ---
  // --- UPSERT 永続化（orders / order_lines） ---
try {
  const now = new Date().toISOString();

  // 既存注文（同一ビジネスキー）があるか？
  const existing = db.prepare(
    `SELECT id FROM orders
      WHERE store_id=? AND vendor_mode=? AND (vendor_id IS ? OR vendor_id=?)
        AND order_date=?`
  ).get(
    b.storeId,
    b.vendorMode,
    b.vendorId ?? null,
    b.vendorId ?? null,
    b.orderDate
  ) as { id?: string } | undefined;

  const targetOrderId = existing?.id ?? orderId;

  const tx = db.transaction(() => {
    if (existing?.id) {
      // 既存ヘッダーを更新
      db.prepare(
        `UPDATE orders
            SET expected_arrival_date=?,
                subtotal=?, tax=?, total=?, tax_rate=?,
                updated_at=?
          WHERE id=?`
      ).run(
        b.expectedArrivalDate ?? null,
        subtotal,
        tax,
        total,
        taxRate,
        now,
        targetOrderId
      );

      // 旧明細を全削除→入れ直し
      db.prepare(`DELETE FROM order_lines WHERE order_id=?`).run(targetOrderId);
    } else {
      // 新規ヘッダーを作成
      db.prepare(
        `INSERT INTO orders
           (id, store_id, vendor_id, vendor_mode, order_date, expected_arrival_date,
            subtotal, tax, total, tax_rate, created_at, updated_at)
         VALUES (?,  ?,        ?,         ?,          ?,                ?,
                 ?,      ?,    ?,      ?,       ?,          ?)`
      ).run(
        targetOrderId,
        b.storeId,
        b.vendorId ?? null,
        b.vendorMode,
        b.orderDate,
        b.expectedArrivalDate ?? null,
        subtotal,
        tax,
        total,
        taxRate,
        now,
        now
      );
    }

    // 明細を再投入
    const lineStmt = db.prepare(
      `INSERT INTO order_lines
        (order_id, item_id, qty, unit_price, amount, expected_arrival_date, vendor_id)
      VALUES (?,        ?,       ?,   ?,          ?,      ?,                   ?)`
    );

    for (const l of normalizedLines) {
      lineStmt.run(
        targetOrderId,
        l.itemId,
        l.qty,
        l.unitPrice,
        l.amount,
        l.expectedArrivalDate,
        l.vendorId ?? null
      );
    }
  });
  tx();

  console.log(
    `[DB] order ${existing ? "updated" : "inserted"}: ${targetOrderId} (${normalizedLines.length} lines)`
  );

  // 既存があれば 200、なければ 201 を返す
  return res.status(existing ? 200 : 201).json({
    status: existing ? "updated" : "accepted",
    orderId: targetOrderId,
    totals: { subtotal, tax, total, taxRate },
    acceptedLines: normalizedLines.length,
  });
} catch (e) {
  console.error("[DB] upsert failed", e);
  return res.status(500).json({ status: "error", error: "DB upsert failed" });
}

  return res.status(201).json({
    status: "accepted",
    orderId,
    totals: { subtotal, tax, total, taxRate },
    acceptedLines: normalizedLines.length,
  });
});

// CORS（proxyを使うなら不要だが、直叩きでも通せるよう保険で入れておく）任意
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:5173");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
// TEMP: 実DBの item_prices の列名確認
app.get("/_debug/item_prices_columns", (_req, res) => {
  const cols = db.prepare("PRAGMA table_info(item_prices)").all();
  res.json(cols);
});

app.get("/ordering/rules", (req: any, res: any) => {
  const storeId = String(req.query.storeId || "").trim();
  const orderDate = String(req.query.orderDate || "").trim(); // "YYYY-MM-DD"

  // --- 1) パラメータバリデーション -----------------
  if (!storeId || !orderDate || !/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) {
    return res.status(400).json({ error: "invalid params" });
  }

  // --- 2) 店舗の存在/有効性チェック -----------------
  const storeRow = db.prepare(`
    SELECT store_id, store_name, is_active
    FROM stores
    WHERE store_id = ? AND is_active = 1
  `).get(storeId);

  if (!storeRow) {
    return res.status(404).json({ error: "store not found or inactive" });
  }

  // 3) この店舗が扱っているベンダー一覧 -------------
  // ※ ここから置換
  type VendorRow = { vendorId: string; vendorName: string };

  const stmtVendors = db.prepare(`
    SELECT DISTINCT
      svi.vendor_id   AS vendorId,
      v.vendor_name   AS vendorName
    FROM store_vendor_items svi
    JOIN vendors v ON v.vendor_id = svi.vendor_id
    WHERE svi.store_id = ?
  `);

  // better-sqlite3 の .all() は型情報が落ちやすいので、いったん any[] に固定してから整形
  const vendorRowsAny = stmtVendors.all(storeId) as any[];

  const vendorRows: VendorRow[] = Array.isArray(vendorRowsAny)
    ? vendorRowsAny.map((r: any) => ({
        vendorId: String(r.vendorId),
        vendorName: String(r.vendorName),
      }))
    : [];

  // 4) 判定処理 ---------------------------------------
  const dow = getDow(orderDate); // 0=Sun..6=Sat

  const vendorsResult: VendorRuleResult[] = [];
  let anyOrderable = false;
  let allClosed = true;
  let earliestCutoff: string | null = null;

  // ※ “分割代入(for-of の { vendorId } など)” は避ける（unknown 連鎖の芽を摘む）
  for (let i = 0; i < vendorRows.length; i++) {
    const vRow = vendorRows[i] as VendorRow;      // 明示固定
    const vendorId = vRow.vendorId;
    const vendorName = vRow.vendorName;

    const baseRule = loadWeeklyRuleForVendor(db, vendorId);
    const overrideRule = loadOverrideForStoreVendor(db, storeId, vendorId);

    if (!baseRule && !overrideRule) {
      vendorsResult.push({
        vendorId,
        vendorName,
        orderable: false,
        isClosed: true,
        cutoffTime: null,
        leadTimeDays: null,
        deliveryDate: null,
        notes: "ルール未設定",
      });
      continue;
    }

    const dayRule = pickRuleForDow(dow, baseRule, overrideRule);
    const closed = !dayRule.orderable || isClosedNow(orderDate, dayRule.cutoffHHMM);

    if (dayRule.orderable) anyOrderable = true;
    if (!closed)           allClosed   = false;

    if (dayRule.orderable && dayRule.cutoffHHMM) {
      if (!earliestCutoff || dayRule.cutoffHHMM < earliestCutoff) {
        earliestCutoff = dayRule.cutoffHHMM;
      }
    }

    const deliveryDate = calcDeliveryDate(orderDate, dayRule.leadTimeDays);

    vendorsResult.push({
      vendorId,
      vendorName,
      orderable: dayRule.orderable,
      isClosed: closed,
      cutoffTime: dayRule.cutoffHHMM,
      leadTimeDays: dayRule.leadTimeDays,
      deliveryDate,
      notes: dayRule.note ?? null,
    });
  }

  const summary = {
    anyOrderable,
    allClosed,
    earliestCutoffTime: earliestCutoff,
    statusText: buildStatusText(anyOrderable, allClosed)
  };

  const responseBody = {
    storeId,
    orderDate,
    cutoffCheckedAt: new Date().toISOString(), // JSTにそろえるなら後で調整OK
    vendors: vendorsResult,
    summary
  };

  return res.json(responseBody);
});

// --- Shipments API (一覧・明細・登録・明細追加/更新) -------------------------

// 一覧取得: GET /shipments?from=YYYY-MM-DD&to=YYYY-MM-DD&vendorId=xxxxxx&destinationId=xxxx
app.get('/shipments', (req, res) => {
  try {
    const q = `
      SELECT
        id,
        delivery_date,
        status,
        vendor_id,
        vendor_name,
        destination_id,
        destination_name,
        created_at,
        updated_at
      FROM v_shipments
      WHERE 1=1
        AND (@from IS NULL OR delivery_date >= @from)
        AND (@to   IS NULL OR delivery_date <= @to)
        AND (@vendorId IS NULL OR vendor_id = @vendorId)
        AND (@destinationId IS NULL OR destination_id = @destinationId)
      ORDER BY delivery_date, vendor_id, destination_id
    `;
    const rows = db.prepare(q).all({
      from: (req.query.from as string) ?? null,
      to: (req.query.to as string) ?? null,
      vendorId: (req.query.vendorId as string) ?? null,
      destinationId: (req.query.destinationId as string) ?? null,
    });
    res.json(rows);
  } catch (e:any) {
    console.error('GET /shipments error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 明細取得: GET /shipments/:id/lines
app.get('/shipments/:id/lines', (req, res) => {
  try {
    const q = `
      SELECT
        id,
        shipment_id,
        item_id,
        item_name,
        ordered_qty,
        ship_qty,
        unit_price,
        amount,
        unit,
        spec,
        temp_zone,
        lot_no,
        note
      FROM v_shipment_lines
      WHERE shipment_id = @shipmentId
      ORDER BY item_id
    `;
    const rows = db.prepare(q).all({ shipmentId: req.params.id });
    res.json(rows);
  } catch (e:any) {
    console.error('GET /shipments/:id/lines error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 伝票ヘッダの作成/取得(UPSERT): POST /shipments
// body: { vendor_id, destination_id, delivery_date, destination_name?, status? }
app.post('/shipments', (req, res) => {
  try {
    const p = req.body ?? {};
    if (!p.vendor_id || !p.destination_id || !p.delivery_date) {
      return res.status(400).json({ error: 'vendor_id, destination_id, delivery_date は必須です' });
    }

    const upsert = `
      INSERT INTO shipments (vendor_id, destination_id, destination_name, delivery_date, status)
      VALUES (@vendor_id, @destination_id, @destination_name, @delivery_date, COALESCE(@status,'open'))
      ON CONFLICT(vendor_id, destination_id, delivery_date) DO UPDATE SET
        destination_name = COALESCE(excluded.destination_name, shipments.destination_name),
        status           = COALESCE(excluded.status, shipments.status),
        updated_at       = datetime('now')
    `;
    db.prepare(upsert).run({
      vendor_id: p.vendor_id,
      destination_id: p.destination_id,
      destination_name: p.destination_name ?? null,
      delivery_date: p.delivery_date,
      status: p.status ?? null,
    });

    const getId = `
      SELECT id FROM shipments
      WHERE vendor_id=@vendor_id AND destination_id=@destination_id AND delivery_date=@delivery_date
    `;
    const row = db.prepare(getId).get({
      vendor_id: p.vendor_id,
      destination_id: p.destination_id,
      delivery_date: p.delivery_date,
    }) as IdRow | undefined;

    res.json({ ok: true, shipmentId: row?.id ?? null });

  } catch (e:any) {
    console.error('POST /shipments error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 明細の追加/更新(UPSERT): POST /shipments/:shipmentId/lines
// body: { item_id, ordered_qty, ship_qty, unit_price, unit?, spec?, temp_zone?, lot_no?, note? }
app.post('/shipments/:shipmentId/lines', (req, res) => {
  try {
    const sid = req.params.shipmentId;
    const p = req.body ?? {};
    if (!p.item_id) return res.status(400).json({ error: 'item_id は必須です' });

    const upsert = `
      INSERT INTO shipment_lines (
        shipment_id, item_id, ordered_qty, ship_qty, unit_price, unit, spec, temp_zone, lot_no, note
      ) VALUES (
        @shipment_id, @item_id, COALESCE(@ordered_qty,0), COALESCE(@ship_qty,0),
        COALESCE(@unit_price,0), @unit, @spec, @temp_zone, @lot_no, @note
      )
      ON CONFLICT(shipment_id, item_id) DO UPDATE SET
        ordered_qty = COALESCE(excluded.ordered_qty, shipment_lines.ordered_qty),
        ship_qty    = COALESCE(excluded.ship_qty,    shipment_lines.ship_qty),
        unit_price  = COALESCE(excluded.unit_price,  shipment_lines.unit_price),
        unit        = COALESCE(excluded.unit,        shipment_lines.unit),
        spec        = COALESCE(excluded.spec,        shipment_lines.spec),
        temp_zone   = COALESCE(excluded.temp_zone,   shipment_lines.temp_zone),
        lot_no      = COALESCE(excluded.lot_no,      shipment_lines.lot_no),
        note        = COALESCE(excluded.note,        shipment_lines.note)
    `;
    db.prepare(upsert).run({
      shipment_id: sid,
      item_id: p.item_id,
      ordered_qty: p.ordered_qty ?? null,
      ship_qty: p.ship_qty ?? null,
      unit_price: p.unit_price ?? null,
      unit: p.unit ?? null,
      spec: p.spec ?? null,
      temp_zone: p.temp_zone ?? null, // 'ambient'|'chilled'|'frozen' を推奨
      lot_no: p.lot_no ?? null,
      note: p.note ?? null,
    });

    res.json({ ok: true });
  } catch (e:any) {
    console.error('POST /shipments/:shipmentId/lines error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 明細の部分更新: PATCH /shipments/:shipmentId/lines/:itemId
// body は上と同じキーを任意で（amount はトリガに任せる）
app.patch('/shipments/:shipmentId/lines/:itemId', (req, res) => {
  try {
    const q = `
      UPDATE shipment_lines
         SET
           ordered_qty = COALESCE(@ordered_qty, ordered_qty),
           ship_qty    = COALESCE(@ship_qty,    ship_qty),
           unit_price  = COALESCE(@unit_price,  unit_price),
           unit        = COALESCE(@unit,        unit),
           spec        = COALESCE(@spec,        spec),
           temp_zone   = COALESCE(@temp_zone,   temp_zone),
           lot_no      = COALESCE(@lot_no,      lot_no),
           note        = COALESCE(@note,        note)
       WHERE shipment_id = @shipmentId
         AND item_id     = @itemId
    `;
    db.prepare(q).run({
      shipmentId: req.params.shipmentId,
      itemId: req.params.itemId,
      ordered_qty: req.body?.ordered_qty ?? null,
      ship_qty: req.body?.ship_qty ?? null,
      unit_price: req.body?.unit_price ?? null,
      unit: req.body?.unit ?? null,
      spec: req.body?.spec ?? null,
      temp_zone: req.body?.temp_zone ?? null,
      lot_no: req.body?.lot_no ?? null,
      note: req.body?.note ?? null,
    });
    res.json({ ok: true });
  } catch (e:any) {
    console.error('PATCH /shipments/:shipmentId/lines/:itemId error:', e);
    res.status(500).json({ error: e.message });
  }
});
// 既存: GET /shipments （一覧） / GET /shipments/:id/lines（明細） はそのまま利用

// 1-1) 伝票ヘッダ単体取得: GET /shipments/:id
app.get('/shipments/:id', (req, res) => {
  try {
    const header = db.prepare(`
      SELECT
        id,
        delivery_date  AS deliveryDate,
        status,
        vendor_id      AS vendorId,
        vendor_name    AS vendorName,
        destination_id AS destinationId,
        destination_name AS destinationName,
        created_at     AS createdAt,
        updated_at     AS updatedAt
      FROM v_shipments WHERE id=@id
    `).get({ id: req.params.id });

    const lines = db.prepare(`
      SELECT
        id            AS lineId,
        shipment_id   AS headerId,
        item_id       AS itemId,
        item_name     AS itemName,
        ordered_qty   AS orderedQty,
        ship_qty      AS shipQty,
        unit_price    AS unitPrice,
        amount,
        unit, spec, temp_zone AS tempZone, lot_no AS lotNo, note
      FROM v_shipment_lines WHERE shipment_id=@id
      ORDER BY item_id
    `).all({ id: req.params.id });

    res.json({ header, lines });
  } catch (e:any) { res.status(500).json({ error: e.message }); }
});

// 1-2) ヘッダ更新: PATCH /shipments/:id
app.patch('/shipments/:id', (req, res) => {
  try {
    const p = req.body ?? {};
    db.prepare(`
      UPDATE shipments
         SET delivery_date    = COALESCE(@deliveryDate, delivery_date),
             vendor_id        = COALESCE(@vendorId, vendor_id),
             destination_id   = COALESCE(@destinationId, destination_id),
             destination_name = COALESCE(@destinationName, destination_name),
             status           = COALESCE(@status, status),
             updated_at       = datetime('now')
       WHERE id=@id
    `).run({
      id: req.params.id,
      deliveryDate: p.deliveryDate ?? null,
      vendorId: p.vendorId ?? null,
      destinationId: p.destinationId ?? null,
      destinationName: p.destinationName ?? null,
      status: p.status ?? null,
    });
    res.json({ ok: true });
  } catch (e:any) { res.status(500).json({ error: e.message }); }
});

// 1-3) 明細一括保存（UPSERT配列）: POST /shipments/:id/lines/bulk
// body: VendorOrderLine[] (lineId?, headerId?, itemId, shipQty, orderedQty?, unit?, spec?, tempZone?, lotNo?, note?)
app.post('/shipments/:id/lines/bulk', (req, res) => {
  try {
    const sid = req.params.id;
    const arr = Array.isArray(req.body) ? req.body : [];
    const upsert = db.prepare(`
      INSERT INTO shipment_lines
        (shipment_id, item_id, ordered_qty, ship_qty, unit_price, unit, spec, temp_zone, lot_no, note)
      VALUES
        (@shipment_id, @item_id, COALESCE(@ordered_qty,0), COALESCE(@ship_qty,0),
         COALESCE(@unit_price,0), @unit, @spec, @temp_zone, @lot_no, @note)
      ON CONFLICT(shipment_id, item_id) DO UPDATE SET
        ordered_qty = COALESCE(excluded.ordered_qty, shipment_lines.ordered_qty),
        ship_qty    = COALESCE(excluded.ship_qty,    shipment_lines.ship_qty),
        unit_price  = COALESCE(excluded.unit_price,  shipment_lines.unit_price),
        unit        = COALESCE(excluded.unit,        shipment_lines.unit),
        spec        = COALESCE(excluded.spec,        shipment_lines.spec),
        temp_zone   = COALESCE(excluded.temp_zone,   shipment_lines.temp_zone),
        lot_no      = COALESCE(excluded.lot_no,      shipment_lines.lot_no),
        note        = COALESCE(excluded.note,        shipment_lines.note)
    `);
    const trx = db.transaction((rows:any[]) => {
      for (const r of rows) upsert.run({
        shipment_id: sid,
        item_id: r.itemId,
        ordered_qty: r.orderedQty ?? null,
        ship_qty: r.shipQty ?? null,
        unit_price: r.unitPrice ?? null,
        unit: r.unit ?? null,
        spec: r.spec ?? null,
        temp_zone: r.tempZone ?? null,
        lot_no: r.lotNo ?? null,
        note: r.note ?? null,
      });
    });
    trx(arr);
    res.json({ ok: true });
  } catch (e:any) { res.status(500).json({ error: e.message }); }
});

// 1-4) 新規作成（ヘッダUPSERT＋明細配列）: POST /shipments/create
// body: { deliveryDate, vendorId, destinationId, destinationName?, lines: VendorOrderLine[] }
app.post('/shipments/create', (req, res) => {
  try {
    const p = req.body ?? {};
    if (!p.deliveryDate || !p.vendorId || !p.destinationId) {
      return res.status(400).json({ error: 'deliveryDate, vendorId, destinationId は必須です' });
    }
    // ヘッダUPSERT（既存なら更新してID取得）
    db.prepare(`
      INSERT INTO shipments (vendor_id, destination_id, destination_name, delivery_date, status)
      VALUES (@vendorId, @destinationId, @destinationName, @deliveryDate, 'open')
      ON CONFLICT(vendor_id, destination_id, delivery_date) DO UPDATE SET
        destination_name = COALESCE(excluded.destination_name, shipments.destination_name),
        updated_at       = datetime('now')
    `).run({
      vendorId: p.vendorId,
      destinationId: p.destinationId,
      destinationName: p.destinationName ?? null,
      deliveryDate: p.deliveryDate,
    });
    const row = db.prepare(`
      SELECT id FROM shipments
      WHERE vendor_id=@vendorId AND destination_id=@destinationId AND delivery_date=@deliveryDate
    `).get({ vendorId: p.vendorId, destinationId: p.destinationId, deliveryDate: p.deliveryDate }) as { id:number };

    // 明細一括
    const lines = Array.isArray(p.lines) ? p.lines : [];
    const upsert = db.prepare(`
      INSERT INTO shipment_lines
        (shipment_id, item_id, ordered_qty, ship_qty, unit_price, unit, spec, temp_zone, lot_no, note)
      VALUES (@sid, @itemId, COALESCE(@orderedQty,0), COALESCE(@shipQty,0),
              COALESCE(@unitPrice,0), @unit, @spec, @tempZone, @lotNo, @note)
      ON CONFLICT(shipment_id, item_id) DO UPDATE SET
        ordered_qty = COALESCE(excluded.ordered_qty, shipment_lines.ordered_qty),
        ship_qty    = COALESCE(excluded.ship_qty,    shipment_lines.ship_qty),
        unit_price  = COALESCE(excluded.unit_price,  shipment_lines.unit_price),
        unit        = COALESCE(excluded.unit,        shipment_lines.unit),
        spec        = COALESCE(excluded.spec,        shipment_lines.spec),
        temp_zone   = COALESCE(excluded.temp_zone,   shipment_lines.temp_zone),
        lot_no      = COALESCE(excluded.lot_no,      shipment_lines.lot_no),
        note        = COALESCE(excluded.note,        shipment_lines.note)
    `);
    const trx = db.transaction((rows:any[], sid:number) => {
      for (const r of rows) upsert.run({
        sid,
        itemId: r.itemId,
        orderedQty: r.orderedQty ?? null,
        shipQty: r.shipQty ?? null,
        unitPrice: r.unitPrice ?? null,
        unit: r.unit ?? null,
        spec: r.spec ?? null,
        tempZone: r.tempZone ?? null,
        lotNo: r.lotNo ?? null,
        note: r.note ?? null,
      });
    });
    trx(lines, row.id);

    // 返却（編集画面がそのまま使える形）
    const header = db.prepare(`
      SELECT id,
             delivery_date  AS deliveryDate,
             status,
             vendor_id      AS vendorId,
             vendor_name    AS vendorName,
             destination_id AS destinationId,
             destination_name AS destinationName
      FROM v_shipments WHERE id=@id
    `).get({ id: row.id });
    res.json({ ok: true, header, linesCount: lines.length });
  } catch (e:any) { res.status(500).json({ error: e.message }); }
});

// 一括確定: POST /shipments/confirm  body: { ids: string[] }
app.post('/shipments/confirm', (req, res) => {
  try {
    const ids: Array<string|number> = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.json({ ok: true });

    const mark = db.prepare(`UPDATE shipments SET status='confirmed', updated_at=datetime('now') WHERE id=@id`);
    const trx = db.transaction((arr: Array<string|number>) => {
      for (const id of arr) mark.run({ id });
    });
    trx(ids);

    res.json({ ok: true, count: ids.length });
  } catch (e:any) {
    res.status(500).json({ error: e.message });
  }
});

// 一括取消: POST /shipments/unconfirm  body: { ids: string[] }
app.post('/shipments/unconfirm', (req, res) => {
  try {
    const ids: Array<string|number> = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.json({ ok: true });

    const mark = db.prepare(`UPDATE shipments SET status='open', updated_at=datetime('now') WHERE id=@id`);
    const trx = db.transaction((arr: Array<string|number>) => {
      for (const id of arr) mark.run({ id });
    });
    trx(ids);

    res.json({ ok: true, count: ids.length });
  } catch (e:any) {
    res.status(500).json({ error: e.message });
  }
});

// 置換保存: POST /shipments/:id/lines/replace
// 要求ボディ: { lines: [{ itemId, shipQty, unit?, spec?, tempZone?, lotNo?, note? , itemName? }] }
app.post('/shipments/:id/lines/replace', (req, res) => {
  const sid = String(req.params.id);
  const body = req.body || {};
  const lines = Array.isArray(body.lines) ? body.lines : [];

  const normId = (s: string) => String(s ?? '').replace(/\D/g, '').padStart(6, '0');

  const txn = db.transaction(() => {
    const keepIds = new Set<string>();
    for (const l of lines) {
      const iid = normId(l.itemId);
      keepIds.add(iid);

      db.prepare(`
        INSERT INTO shipment_lines (shipment_id, item_id, ordered_qty, ship_qty, unit_price, amount, unit, spec, temp_zone, lot_no, note)
        VALUES (@sid, @iid, COALESCE(@ordered_qty,0), COALESCE(@ship_qty,0), COALESCE(@unit_price,0), COALESCE(@amount,0), @unit, @spec, @temp_zone, @lot_no, @note)
        ON CONFLICT (shipment_id, item_id) DO UPDATE SET
          ship_qty    = excluded.ship_qty,
          unit        = excluded.unit,
          spec        = excluded.spec,
          temp_zone   = excluded.temp_zone,
          lot_no      = excluded.lot_no,
          note        = excluded.note
      `).run({
        sid,
        iid,
        ordered_qty: l.orderedQty ?? 0,
        ship_qty:    l.shipQty ?? 0,
        unit_price:  l.unitPrice ?? 0,
        amount:      l.amount ?? (l.unitPrice ?? 0) * (l.shipQty ?? 0),
        unit:        l.unit ?? '',
        spec:        l.spec ?? '',
        temp_zone:   l.tempZone ?? null,
        lot_no:      l.lotNo ?? '',
        note:        l.note ?? '',
      });
    }

    // ★ ここがポイント：送られてこなかった明細は削除（＝“復活”の根本原因を断つ）
    const placeholders = Array.from(keepIds).map(() => '?').join(',');
    if (keepIds.size > 0) {
      db.prepare(`
        DELETE FROM shipment_lines
        WHERE shipment_id = ? AND item_id NOT IN (${placeholders})
      `).run(sid, ...Array.from(keepIds));
    } else {
      // 1行も残さない場合：全削除
      db.prepare(`DELETE FROM shipment_lines WHERE shipment_id = ?`).run(sid);
    }

    // ヘッダの updated_at 更新
    db.prepare(`UPDATE shipments SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(sid);
  });

  try {
    txn();
    res.json({ ok: true });
  } catch (e:any) {
    res.status(500).json({ error: e.message });
  }
});

// === ベンダー取扱品目（vendor_items × items）===
// GET /master/vendors/:vendorId/items
app.get('/master/vendors/:vendorId/items', (req, res) => {
  try {
    const vendorId = String(req.params.vendorId || '').replace(/\D/g, '').padStart(6, '0');

    const rows = db.prepare(`
      SELECT i.id, i.name, i.spec, i.unit, i.temp_zone AS tempZone
        FROM vendor_items vi
        JOIN items i ON i.id = vi.item_id
       WHERE vi.vendor_id = @vendorId
       GROUP BY i.id
       ORDER BY i.id
    `).all({ vendorId });

    res.json(rows);
  } catch (e:any) {
    res.status(500).json({ error: e.message });
  }
});

// 追加：納品先（stores）一覧 API
app.get('/master/stores', (_req, res) => {
  try {
    const rows = db.prepare(`SELECT id, name FROM stores ORDER BY id`).all();
    res.json(rows);
  } catch (e:any) { res.status(500).json({ error: e.message }); }
});

// 受注→出荷の集計（orders.order_date / order_lines.qty, unit_price を使用）
// vendor_weekly_rules は曜日別カラム *_sun..*_sat から CASE で取得
const AGG_SQL = `
WITH src AS (
  SELECT
    COALESCE(o.vendor_id, ol.vendor_id) AS vendor_id,
    o.store_id                           AS destination_id,  -- ← ここを固定
    o.order_date                         AS order_date,
    ol.item_id                           AS item_id,
    COALESCE(ol.qty, 0)                  AS qty,
    COALESCE(ol.unit_price, 0)           AS unit_price
  FROM orders o
  JOIN order_lines ol ON ol.order_id = o.id
),
vwr AS (
  SELECT vendor_id,
         lead_time_days_sun, lead_time_days_mon, lead_time_days_tue, lead_time_days_wed,
         lead_time_days_thu, lead_time_days_fri, lead_time_days_sat,
         cutoff_hhmm_sun, cutoff_hhmm_mon, cutoff_hhmm_tue, cutoff_hhmm_wed,
         cutoff_hhmm_thu, cutoff_hhmm_fri, cutoff_hhmm_sat
  FROM vendor_weekly_rules
)
SELECT
  s.vendor_id AS vendor_id,
  s.destination_id AS destination_id,
  date(
    s.order_date,
    '+' || (
      CASE strftime('%w', s.order_date)
        WHEN '0' THEN COALESCE(v.lead_time_days_sun, 1)
        WHEN '1' THEN COALESCE(v.lead_time_days_mon, 1)
        WHEN '2' THEN COALESCE(v.lead_time_days_tue, 1)
        WHEN '3' THEN COALESCE(v.lead_time_days_wed, 1)
        WHEN '4' THEN COALESCE(v.lead_time_days_thu, 1)
        WHEN '5' THEN COALESCE(v.lead_time_days_fri, 1)
        WHEN '6' THEN COALESCE(v.lead_time_days_sat, 1)
      END
    ) || ' day'
  ) AS delivery_date,
  s.item_id AS item_id,
  SUM(s.qty) AS sum_qty,
  MAX(s.unit_price) AS unit_price,
  (CASE strftime('%w', s.order_date)
     WHEN '0' THEN COALESCE(v.cutoff_hhmm_sun, '00:00')
     WHEN '1' THEN COALESCE(v.cutoff_hhmm_mon, '00:00')
     WHEN '2' THEN COALESCE(v.cutoff_hhmm_tue, '00:00')
     WHEN '3' THEN COALESCE(v.cutoff_hhmm_wed, '00:00')
     WHEN '4' THEN COALESCE(v.cutoff_hhmm_thu, '00:00')
     WHEN '5' THEN COALESCE(v.cutoff_hhmm_fri, '00:00')
     WHEN '6' THEN COALESCE(v.cutoff_hhmm_sat, '00:00')
   END) AS cutoff_hhmm,
  (CASE strftime('%w', s.order_date)
     WHEN '0' THEN COALESCE(v.lead_time_days_sun, 1)
     WHEN '1' THEN COALESCE(v.lead_time_days_mon, 1)
     WHEN '2' THEN COALESCE(v.lead_time_days_tue, 1)
     WHEN '3' THEN COALESCE(v.lead_time_days_wed, 1)
     WHEN '4' THEN COALESCE(v.lead_time_days_thu, 1)
     WHEN '5' THEN COALESCE(v.lead_time_days_fri, 1)
     WHEN '6' THEN COALESCE(v.lead_time_days_sat, 1)
   END) AS lead_time_days
FROM src s
LEFT JOIN vwr v ON v.vendor_id = s.vendor_id
GROUP BY s.vendor_id, s.destination_id, delivery_date, s.item_id
-- HAVING time(?) > time(cutoff_hhmm)
ORDER BY vendor_id, destination_id, delivery_date, item_id
`;

// ========== プレビュー（DBに書かない） ==========
app.post('/shipments/generate/preview', (req, res) => {
  try {
    const p = req.body ?? {};
    const from = String(p.from ?? p.date ?? '').trim(); // なくてもOK（現状SQLは日付範囲未使用）
    const to   = String(p.to   ?? p.date ?? '').trim();

    // // ※ from/to を使う場合は src に BETWEEN などを足す。まずは締切超過判定の動作優先。
    // const rows = db.prepare(AGG_SQL).all(nowHHmmJST()) as AggRow[];
    const rows = db.prepare(AGG_SQL).all() as AggRow[];

    // レスポンス（画面にわかりやすく）
    // const headers = new Map<string, {store_id:string; vendor_id:string; delivery_date:string; lines: any[]}>();
    const headers = new Map<string, HeaderGroup>();
    for (const r of rows) {
      const key = `${r.destination_id}|${r.vendor_id}|${r.delivery_date}`;
      if (!headers.has(key)) headers.set(key, { destination_id: r.destination_id, vendor_id: r.vendor_id, delivery_date: r.delivery_date, lines: [] });
      headers.get(key)!.lines.push({
        item_id: r.item_id,
        ordered_qty: r.sum_qty,
        ship_qty: r.sum_qty,
        unit_price: r.unit_price,
        amount: Math.round(r.sum_qty * r.unit_price),
      });
    }

    res.json({
      ok: true,
      nowHHmm: nowHHmmJST(),
      headers: Array.from(headers.values()),
      countHeaders: headers.size,
      countLines: rows.length,
    });
  } catch (e: any) {
    console.error('[/shipments/generate/preview] error:', e);
    res.status(500).json({ ok:false, error: String(e?.message ?? e) });
  }
});

// ========== 本番生成（UPSERTで冪等） ==========
app.post('/shipments/generate', (req, res) => {
  const tx = db.transaction(() => {
    // 1) 締切超過の受注を集計
    // const rows = db.prepare(AGG_SQL).all(nowHHmmJST()) as AggRow[];
        const rows = db.prepare(AGG_SQL).all() as AggRow[];
    // 2) 出荷ヘッダ UPSERT（vendor_id × destination_id × delivery_date）
    const upsertHeader = db.prepare(`
      INSERT INTO shipments (
        vendor_id,
        destination_id,
        delivery_date,
        status,
        created_at,
        updated_at
      )
      VALUES (
        @vendor_id,
        @destination_id,
        @delivery_date,
        'open',
        datetime('now','localtime'),
        datetime('now','localtime')
      )
      ON CONFLICT(vendor_id, destination_id, delivery_date)
      DO UPDATE SET
        updated_at = excluded.updated_at
      RETURNING id
    `);

    const delLines = db.prepare(
      `DELETE FROM shipment_lines WHERE shipment_id = ?`
    );

    // 3) shipment_lines のカラム構成を見て INSERT を切り替え
    const cols = db
      .prepare(`PRAGMA table_info('shipment_lines')`)
      .all() as Array<{ name: string }>;
    const hasOrdered = cols.some((c) => c.name === "ordered_qty");
    const hasShip = cols.some((c) => c.name === "ship_qty");

    let insLine: ReturnType<typeof db.prepare>;
    if (hasOrdered && hasShip) {
      // 新スキーマ：ordered_qty / ship_qty がある
      insLine = db.prepare(`
        INSERT INTO shipment_lines (
          shipment_id,
          item_id,
          ordered_qty,
          ship_qty,
          unit_price,
          amount
        )
        VALUES (
          @shipment_id,
          @item_id,
          @ordered_qty,
          @ship_qty,
          @unit_price,
          @amount
        )
      `);
    } else {
      // 旧スキーマ：qty だけ
      insLine = db.prepare(`
        INSERT INTO shipment_lines (
          shipment_id,
          item_id,
          qty,
          unit_price,
          amount
        )
        VALUES (
          @shipment_id,
          @item_id,
          @ship_qty,
          @unit_price,
          @amount
        )
      `);
    }

    // 4) 集計結果をヘッダ単位にまとめる（vendor_id × destination_id × delivery_date）
    const grouped = new Map<string, HeaderGroup>();
    for (const r of rows) {
      const key = `${r.vendor_id}|${r.destination_id}|${r.delivery_date}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          vendor_id: r.vendor_id,
          destination_id: r.destination_id,
          delivery_date: r.delivery_date,
          lines: [],
        });
      }
      const h = grouped.get(key)!;
      h.lines.push({
        item_id: r.item_id,
        ordered_qty: r.sum_qty,
        ship_qty: r.sum_qty,
        unit_price: r.unit_price,
        amount: Math.round(r.sum_qty * r.unit_price),
      });
    }

    // 5) ヘッダごとに INSERT/UPDATE + 明細全差し替え
    let headersAffected = 0;
    let linesAffected = 0;

    for (const h of Array.from(grouped.values())) {
      const row = upsertHeader.get(h) as { id: number } | undefined;
      const shipment_id = row?.id;
      if (!shipment_id) continue;

      // 既存明細削除
      delLines.run(shipment_id);
      headersAffected++;

      // 新しい明細を全部入れ直す
      for (const l of h.lines) {
        insLine.run({ shipment_id, ...l });
        linesAffected++;
      }
    }

    return { headersAffected, linesAffected };
  });

  try {
    const out = tx();
    res.json({ ok: true, ...out });
  } catch (e: any) {
    console.error("[/shipments/generate] error:", e);
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// --- debug: いま起動しているプロセス確認用（あとで消してOK） ---
app.get('/__debug/master', (_req, res) => {
  try {
    const items = db.prepare('SELECT COUNT(*) AS c FROM items').get() as { c: number };
    const stores = db.prepare('SELECT COUNT(*) AS c FROM stores').get() as { c: number };
    res.json({
      ok: true,
      itemsCount: items?.c ?? 0,
      storesCount: stores?.c ?? 0,
      hasItemsRoute: true,  // このハンドラが返る = このファイルが動いている証拠
      ts: new Date().toISOString(),
    });
  } catch (e:any) {
    res.status(500).json({ error: e.message });
  }
});

// ====== Start ======
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}  (db=${DB_PATH})`);
});

app.listen(8080, () => {
  console.log("Server started on http://localhost:8080");
});

