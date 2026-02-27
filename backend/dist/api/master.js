"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.master = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const id_1 = require("../lib/id");
exports.master = (0, express_1.Router)();
function csvDateStyleFromQuery(v) {
    return v === "slash" ? "slash" : "iso"; // デフォルト iso
}
function formatDateForCsv(s, style) {
    if (!s)
        return "";
    const str = String(s).trim();
    // DBは YYYY-MM-DD 前提（入力バリデーションもそうなってる）
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m)
        return str;
    const [, y, mo, d] = m;
    return style === "iso" ? `${y}-${mo}-${d}` : `${y}/${mo}/${d}`; // Excel向け
}
/** ベンダ一覧（VendorShipments/VendorEdit のモーダルで使用） */
exports.master.get('/vendors', (_req, res) => {
    try {
        const rows = db_1.db.prepare(`
      SELECT id, name
        FROM vendors
       ORDER BY id
    `).all();
        // ★ 配列そのものを返す
        res.json(rows);
    }
    catch (e) {
        res.status(500).json({ error: String(e?.message ?? e) });
    }
});
/** 店舗一覧（VendorEdit の納品先モーダル／マスタメンテでも使用）
 *  query: includeInactive=1 で非稼働も含める
 */
exports.master.get('/stores', (req, res) => {
    try {
        const includeInactive = String(req.query.includeInactive ?? "") === "1";
        const rows = db_1.db.prepare(`
      SELECT
        id,
        name,
        is_active AS isActive
      FROM stores
      ${includeInactive ? "" : "WHERE is_active = 1"}
      ORDER BY id
    `).all();
        // ★ 配列そのものを返す（旧 server.ts と同じ）
        res.json(rows);
    }
    catch (e) {
        res.status(500).json({ error: String(e?.message ?? e) });
    }
});
/** ベンダ登録/更新（マスタメンテ用） */
exports.master.post('/vendors/upsert', (req, res) => {
    try {
        const idRaw = String(req.body?.id ?? "");
        const nameRaw = String(req.body?.name ?? "").trim();
        const id = id_1.ID.vendor(idRaw);
        if (!id || id.length !== 6) {
            return res.status(400).json({ ok: false, error: "invalid vendor id" });
        }
        if (!nameRaw) {
            return res.status(400).json({ ok: false, error: "name is required" });
        }
        db_1.db.prepare(`
      INSERT INTO vendors (id, name)
      VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name
    `).run(id, nameRaw);
        res.json({ ok: true, id });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
/** 店舗登録/更新（マスタメンテ用） */
exports.master.post('/stores/upsert', (req, res) => {
    try {
        const idRaw = String(req.body?.id ?? "");
        const nameRaw = String(req.body?.name ?? "").trim();
        const isActiveRaw = req.body?.isActive;
        const id = id_1.ID.store(idRaw);
        if (!id || id.length !== 4) {
            return res.status(400).json({ ok: false, error: "invalid store id" });
        }
        if (!nameRaw) {
            return res.status(400).json({ ok: false, error: "name is required" });
        }
        const isActive = (Number(isActiveRaw) === 0 ? 0 : 1);
        const code = String(req.body?.code ?? "").trim() || id; // stores.code が必須なので id をデフォルトに
        db_1.db.prepare(`
      INSERT INTO stores (id, code, name, is_active)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code,
        name = excluded.name,
        is_active = excluded.is_active
    `).run(id, code, nameRaw, isActive);
        res.json({ ok: true, id });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
exports.master.get("/vendors.csv", (_req, res) => {
    const rows = db_1.db.prepare(`SELECT id, name FROM vendors ORDER BY id`).all();
    const csv = ["id,name", ...rows.map(r => `${r.id},${(r.name ?? "").replaceAll('"', '""')}`)].join("\n");
    sendCsv(res, "vendors.csv", csv);
});
exports.master.get("/stores.csv", (req, res) => {
    const includeInactive = String(req.query.includeInactive ?? "") === "1";
    const rows = db_1.db.prepare(`
    SELECT id, code, name, is_active AS isActive
    FROM stores
    ${includeInactive ? "" : "WHERE is_active = 1"}
    ORDER BY id
  `).all();
    const csv = ["id,code,name,isActive", ...rows.map(r => `${r.id},${r.code},${(r.name ?? "").replaceAll('"', '""')},${r.isActive}`)].join("\n");
    sendCsv(res, "stores.csv", csv);
});
/** 全品目（フォールバック用＋マスタメンテ用）
 *  query: includeInactive=1 で非稼働も含める
 */
exports.master.get("/items", (req, res) => {
    try {
        const includeInactive = String(req.query.includeInactive ?? "") === "1";
        const rows = db_1.db
            .prepare(`
        SELECT
          id,
          name,
          unit,
          spec,
          temp_zone  AS tempZone,
          is_active  AS isActive,
          stock_unit AS stockUnit,
          stock_conv AS stockConv
        FROM items
        ${includeInactive ? "" : "WHERE is_active = 1"}
        ORDER BY id
        `)
            .all();
        // 既存互換：{ items: [...] } で返す（今のフロントを壊さない）
        res.json({ items: rows });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
/** ベンダー取扱品目（重複除去：DISTINCT） */
exports.master.get('/vendors/:vendorId/items', (req, res) => {
    try {
        const vendorId = id_1.ID.vendor(req.params.vendorId || '');
        const rows = db_1.db.prepare(`
      SELECT DISTINCT
        i.id AS id,
        i.name AS name,
        i.spec AS spec,
        i.unit AS unit,
        i.temp_zone AS tempZone
      FROM vendor_items vi
      JOIN items i ON i.id = vi.item_id
     WHERE vi.vendor_id = @vendorId
     ORDER BY i.id
    `).all({ vendorId });
        // ★ 配列そのものを返す（旧 server.ts と同じ）
        res.json(rows);
    }
    catch (e) {
        res.status(500).json({ error: String(e?.message ?? e) });
    }
});
function isYmd(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
// YYYY-MM-DD 文字列比較でOK（同形式固定が前提）
function overlaps(aFrom, aTo, bFrom, bTo) {
    const aEnd = aTo ?? "9999-12-31";
    const bEnd = bTo ?? "9999-12-31";
    return aFrom <= bEnd && bFrom <= aEnd;
}
function toNullIfEmpty(s) {
    const v = String(s ?? "").trim();
    return v === "" ? null : v;
}
/** item_prices 一覧（vendorId/itemId は任意） */
exports.master.get("/item-prices", (req, res) => {
    try {
        const vendorId = req.query.vendorId ? id_1.ID.vendor(String(req.query.vendorId)) : null;
        const itemId = req.query.itemId ? id_1.ID.item(String(req.query.itemId)) : null;
        const rows = db_1.db.prepare(`
      SELECT
        id,
        vendor_id  AS vendorId,
        item_id    AS itemId,
        unit_price AS unitPrice,
        valid_from AS validFrom,
        valid_to   AS validTo
      FROM item_prices
      WHERE (@vendorId IS NULL OR vendor_id = @vendorId)
        AND (@itemId   IS NULL OR item_id   = @itemId)
      ORDER BY vendor_id, item_id, valid_from
      `).all({ vendorId, itemId });
        res.json({ ok: true, rows });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
/**
 * item_prices upsert（最小バリデーション）
 * body: { id?, vendorId, itemId, unitPrice, validFrom, validTo? }
 */
exports.master.post("/item-prices/upsert", (req, res) => {
    try {
        const body = (req.body ?? {});
        // const id = body.id ? Number(body.id) : null;
        const vendorId = id_1.ID.vendor(body.vendorId ?? "");
        const itemId = id_1.ID.item(body.itemId ?? "");
        const unitPriceRaw = Number(body.unitPrice);
        const unitPrice = Number.isFinite(unitPriceRaw) ? unitPriceRaw : NaN;
        const validFrom = String(body.validFrom ?? "").trim();
        const validTo = toNullIfEmpty(body.validTo);
        // 必須チェック
        if (!vendorId || !itemId) {
            return res.status(400).json({ ok: false, error: "vendorId/itemId is required" });
        }
        if (!Number.isFinite(unitPrice)) {
            return res.status(400).json({ ok: false, error: "unitPrice must be a number" });
        }
        // ルール：円の整数
        if (!Number.isInteger(unitPrice) || unitPrice <= 0) {
            return res.status(400).json({ ok: false, error: "unitPrice must be integer yen (>0)" });
        }
        if (!isYmd(validFrom)) {
            return res.status(400).json({ ok: false, error: "validFrom must be YYYY-MM-DD" });
        }
        if (validTo && !isYmd(validTo)) {
            return res.status(400).json({ ok: false, error: "validTo must be YYYY-MM-DD or empty" });
        }
        if (validTo && validTo < validFrom) {
            return res.status(400).json({ ok: false, error: "validTo must be >= validFrom" });
        }
        // ★ id 未指定でも「同一 vendor/item/validFrom があれば update 扱い」に寄せる
        let id = body.id ? Number(body.id) : null;
        if (!id) {
            const found = db_1.db
                .prepare(`
          SELECT id FROM item_prices
          WHERE vendor_id=@vendorId AND item_id=@itemId AND valid_from=@validFrom
          `)
                .get({ vendorId, itemId, validFrom });
            if (found?.id) {
                id = found.id; // 以後、overlap 判定で自分を除外できる
            }
        }
        // 重複期間チェック（同 vendor/item 内で overlap 禁止）
        const existing = db_1.db.prepare(`
      SELECT id, valid_from AS validFrom, valid_to AS validTo
      FROM item_prices
      WHERE vendor_id=@vendorId AND item_id=@itemId
      `).all({ vendorId, itemId });
        for (const r of existing) {
            if (id && r.id === id)
                continue;
            if (overlaps(validFrom, validTo, r.validFrom, r.validTo)) {
                return res.status(400).json({
                    ok: false,
                    error: `date range overlaps existing row id=${r.id} (${r.validFrom}..${r.validTo ?? "NULL"})`,
                });
            }
        }
        const tx = db_1.db.transaction(() => {
            if (id) {
                const info = db_1.db.prepare(`
          UPDATE item_prices
             SET vendor_id=@vendorId,
                 item_id=@itemId,
                 unit_price=@unitPrice,
                 valid_from=@validFrom,
                 valid_to=@validTo
           WHERE id=@id
          `).run({ id, vendorId, itemId, unitPrice, validFrom, validTo });
                if (info.changes === 0) {
                    throw new Error(`item_prices not found: id=${id}`);
                }
                return { id };
            }
            else {
                // 同一 vendor/item/valid_from が既にあるなら UPDATE に寄せる
                const found = db_1.db.prepare(`
          SELECT id FROM item_prices
           WHERE vendor_id=@vendorId AND item_id=@itemId AND valid_from=@validFrom
          `).get({ vendorId, itemId, validFrom });
                if (found?.id) {
                    db_1.db.prepare(`
            UPDATE item_prices
               SET unit_price=@unitPrice,
                   valid_to=@validTo
             WHERE id=@id
            `).run({ id: found.id, unitPrice, validTo });
                    return { id: found.id };
                }
                const info = db_1.db.prepare(`
          INSERT INTO item_prices (vendor_id, item_id, unit_price, valid_from, valid_to)
          VALUES (@vendorId, @itemId, @unitPrice, @validFrom, @validTo)
          `).run({ vendorId, itemId, unitPrice, validFrom, validTo });
                return { id: Number(info.lastInsertRowid) };
            }
        });
        const r = tx();
        res.json({ ok: true, ...r });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
/** 異常検出（期間重複/順序不正の検出） */
exports.master.get("/item-prices/anomalies", (req, res) => {
    try {
        const vendorId = req.query.vendorId ? id_1.ID.vendor(String(req.query.vendorId)) : null;
        const rows = db_1.db.prepare(`
      SELECT vendor_id AS vendorId, item_id AS itemId, id, valid_from AS validFrom, valid_to AS validTo, unit_price AS unitPrice
      FROM item_prices
      WHERE (@vendorId IS NULL OR vendor_id=@vendorId)
      ORDER BY vendor_id, item_id, valid_from
      `).all({ vendorId });
        // group by vendorId+itemId
        const key = (r) => `${r.vendorId}__${r.itemId}`;
        const groups = new Map();
        for (const r of rows) {
            const k = key(r);
            if (!groups.has(k))
                groups.set(k, []);
            groups.get(k).push(r);
        }
        const anomalies = [];
        for (const [k, list] of groups.entries()) {
            const sorted = [...list].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
            for (let i = 0; i < sorted.length; i++) {
                const cur = sorted[i];
                if (cur.validTo && cur.validTo < cur.validFrom) {
                    anomalies.push({ type: "INVALID_RANGE", ...cur });
                }
                if (i > 0) {
                    const prev = sorted[i - 1];
                    if (overlaps(prev.validFrom, prev.validTo, cur.validFrom, cur.validTo)) {
                        anomalies.push({
                            type: "OVERLAP",
                            vendorId: cur.vendorId,
                            itemId: cur.itemId,
                            a: { id: prev.id, from: prev.validFrom, to: prev.validTo },
                            b: { id: cur.id, from: cur.validFrom, to: cur.validTo },
                        });
                    }
                }
            }
        }
        res.json({ ok: true, count: anomalies.length, anomalies });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
// === vendor_weekly_rules / store_vendor_overrides 管理（最小）====================
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function isHHMM(v) {
    if (!/^\d{2}:\d{2}$/.test(v))
        return false;
    const [hh, mm] = v.split(":").map((n) => Number(n));
    return Number.isInteger(hh) && Number.isInteger(mm) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}
function parseOrderable(v, allowNull) {
    if (v === undefined)
        return undefined; // 未指定（merge用）
    if (v === null || v === "")
        return allowNull ? null : 0;
    if (typeof v === "boolean")
        return v ? 1 : 0;
    const n = Number(v);
    if (!Number.isFinite(n) || !(n === 0 || n === 1))
        throw new Error("orderable must be 0/1");
    return n;
}
function parseLeadTimeDays(v, allowNull) {
    if (v === undefined)
        return undefined; // 未指定（merge用）
    if (v === null || v === "")
        return allowNull ? null : 1;
    const n = Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0)
        throw new Error("leadTimeDays must be integer >= 0");
    return n;
}
function parseCutoffHHMM(v, allowNull) {
    if (v === undefined)
        return undefined; // 未指定（merge用）
    if (v === null || v === "")
        return allowNull ? null : "04:00";
    const s = String(v);
    if (!isHHMM(s))
        throw new Error("cutoffHhmm must be HH:MM");
    return s;
}
function pick(obj, key) {
    if (!obj)
        return undefined;
    return obj[key];
}
// --- vendor_weekly_rules ------------------------------------------------------
exports.master.get("/vendor-weekly-rules", (req, res) => {
    try {
        const vendorId = req.query.vendorId ? id_1.ID.vendor(String(req.query.vendorId)) : null;
        const rows = db_1.db
            .prepare(`
      SELECT
        vendor_id AS vendorId,
        orderable_sun AS orderableSun, cutoff_hhmm_sun AS cutoffHhmmSun, lead_time_days_sun AS leadTimeDaysSun,
        orderable_mon AS orderableMon, cutoff_hhmm_mon AS cutoffHhmmMon, lead_time_days_mon AS leadTimeDaysMon,
        orderable_tue AS orderableTue, cutoff_hhmm_tue AS cutoffHhmmTue, lead_time_days_tue AS leadTimeDaysTue,
        orderable_wed AS orderableWed, cutoff_hhmm_wed AS cutoffHhmmWed, lead_time_days_wed AS leadTimeDaysWed,
        orderable_thu AS orderableThu, cutoff_hhmm_thu AS cutoffHhmmThu, lead_time_days_thu AS leadTimeDaysThu,
        orderable_fri AS orderableFri, cutoff_hhmm_fri AS cutoffHhmmFri, lead_time_days_fri AS leadTimeDaysFri,
        orderable_sat AS orderableSat, cutoff_hhmm_sat AS cutoffHhmmSat, lead_time_days_sat AS leadTimeDaysSat,
        updated_at AS updatedAt
      FROM vendor_weekly_rules
      WHERE (@vendorId IS NULL OR vendor_id=@vendorId)
      ORDER BY vendor_id
      `)
            .all({ vendorId });
        res.json({ ok: true, rows });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
exports.master.post("/vendor-weekly-rules/upsert", (req, res) => {
    try {
        const body = (req.body ?? {});
        const vendorId = id_1.ID.vendor(body.vendorId ?? "");
        if (!vendorId)
            return res.status(400).json({ ok: false, error: "vendorId is required" });
        // 既存を読む（部分更新を許すため）
        const existing = db_1.db
            .prepare(`SELECT * FROM vendor_weekly_rules WHERE vendor_id=@vendorId`)
            .get({ vendorId });
        // 既存 or デフォルトでベースを作る
        const base = existing ?? { vendor_id: vendorId };
        for (const d of DAYS) {
            base[`orderable_${d}`] = base[`orderable_${d}`] ?? 0;
            base[`cutoff_hhmm_${d}`] = base[`cutoff_hhmm_${d}`] ?? "04:00";
            base[`lead_time_days_${d}`] = base[`lead_time_days_${d}`] ?? 1;
        }
        // body からの上書き（camelCaseで受ける）
        const map = (d) => {
            const D = d.charAt(0).toUpperCase() + d.slice(1);
            const o = parseOrderable(pick(body, `orderable${D}`), false);
            const c = parseCutoffHHMM(pick(body, `cutoffHhmm${D}`), false);
            const l = parseLeadTimeDays(pick(body, `leadTimeDays${D}`), false);
            if (o !== undefined)
                base[`orderable_${d}`] = o;
            if (c !== undefined)
                base[`cutoff_hhmm_${d}`] = c;
            if (l !== undefined)
                base[`lead_time_days_${d}`] = l;
        };
        DAYS.forEach(map);
        // 最終バリデーション（ここで落とす）
        for (const d of DAYS) {
            const o = base[`orderable_${d}`];
            const c = base[`cutoff_hhmm_${d}`];
            const l = base[`lead_time_days_${d}`];
            if (!(o === 0 || o === 1))
                return res.status(400).json({ ok: false, error: `orderable_${d} must be 0/1` });
            if (!isHHMM(String(c)))
                return res.status(400).json({ ok: false, error: `cutoff_hhmm_${d} must be HH:MM` });
            if (!Number.isInteger(l) || l < 0)
                return res.status(400).json({ ok: false, error: `lead_time_days_${d} must be integer >= 0` });
        }
        db_1.db.prepare(`
      INSERT INTO vendor_weekly_rules (
        vendor_id,
        orderable_sun, cutoff_hhmm_sun, lead_time_days_sun,
        orderable_mon, cutoff_hhmm_mon, lead_time_days_mon,
        orderable_tue, cutoff_hhmm_tue, lead_time_days_tue,
        orderable_wed, cutoff_hhmm_wed, lead_time_days_wed,
        orderable_thu, cutoff_hhmm_thu, lead_time_days_thu,
        orderable_fri, cutoff_hhmm_fri, lead_time_days_fri,
        orderable_sat, cutoff_hhmm_sat, lead_time_days_sat,
        updated_at
      ) VALUES (
        @vendor_id,
        @orderable_sun, @cutoff_hhmm_sun, @lead_time_days_sun,
        @orderable_mon, @cutoff_hhmm_mon, @lead_time_days_mon,
        @orderable_tue, @cutoff_hhmm_tue, @lead_time_days_tue,
        @orderable_wed, @cutoff_hhmm_wed, @lead_time_days_wed,
        @orderable_thu, @cutoff_hhmm_thu, @lead_time_days_thu,
        @orderable_fri, @cutoff_hhmm_fri, @lead_time_days_fri,
        @orderable_sat, @cutoff_hhmm_sat, @lead_time_days_sat,
        datetime('now')
      )
      ON CONFLICT(vendor_id) DO UPDATE SET
        orderable_sun=excluded.orderable_sun, cutoff_hhmm_sun=excluded.cutoff_hhmm_sun, lead_time_days_sun=excluded.lead_time_days_sun,
        orderable_mon=excluded.orderable_mon, cutoff_hhmm_mon=excluded.cutoff_hhmm_mon, lead_time_days_mon=excluded.lead_time_days_mon,
        orderable_tue=excluded.orderable_tue, cutoff_hhmm_tue=excluded.cutoff_hhmm_tue, lead_time_days_tue=excluded.lead_time_days_tue,
        orderable_wed=excluded.orderable_wed, cutoff_hhmm_wed=excluded.cutoff_hhmm_wed, lead_time_days_wed=excluded.lead_time_days_wed,
        orderable_thu=excluded.orderable_thu, cutoff_hhmm_thu=excluded.cutoff_hhmm_thu, lead_time_days_thu=excluded.lead_time_days_thu,
        orderable_fri=excluded.orderable_fri, cutoff_hhmm_fri=excluded.cutoff_hhmm_fri, lead_time_days_fri=excluded.lead_time_days_fri,
        orderable_sat=excluded.orderable_sat, cutoff_hhmm_sat=excluded.cutoff_hhmm_sat, lead_time_days_sat=excluded.lead_time_days_sat,
        updated_at=datetime('now')
      `).run(base);
        res.json({ ok: true, vendorId });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
// --- store_vendor_overrides ---------------------------------------------------
exports.master.get("/store-vendor-overrides", (req, res) => {
    try {
        const storeId = req.query.storeId ? id_1.ID.store(String(req.query.storeId)) : null;
        const vendorId = req.query.vendorId ? id_1.ID.vendor(String(req.query.vendorId)) : null;
        const rows = db_1.db
            .prepare(`
      SELECT
        store_id AS storeId,
        vendor_id AS vendorId,

        orderable_sun_override AS orderableSunOverride,
        cutoff_hhmm_sun_override AS cutoffHhmmSunOverride,
        lead_time_days_sun_override AS leadTimeDaysSunOverride,

        orderable_mon_override AS orderableMonOverride,
        cutoff_hhmm_mon_override AS cutoffHhmmMonOverride,
        lead_time_days_mon_override AS leadTimeDaysMonOverride,

        orderable_tue_override AS orderableTueOverride,
        cutoff_hhmm_tue_override AS cutoffHhmmTueOverride,
        lead_time_days_tue_override AS leadTimeDaysTueOverride,

        orderable_wed_override AS orderableWedOverride,
        cutoff_hhmm_wed_override AS cutoffHhmmWedOverride,
        lead_time_days_wed_override AS leadTimeDaysWedOverride,

        orderable_thu_override AS orderableThuOverride,
        cutoff_hhmm_thu_override AS cutoffHhmmThuOverride,
        lead_time_days_thu_override AS leadTimeDaysThuOverride,

        orderable_fri_override AS orderableFriOverride,
        cutoff_hhmm_fri_override AS cutoffHhmmFriOverride,
        lead_time_days_fri_override AS leadTimeDaysFriOverride,

        orderable_sat_override AS orderableSatOverride,
        cutoff_hhmm_sat_override AS cutoffHhmmSatOverride,
        lead_time_days_sat_override AS leadTimeDaysSatOverride,

        updated_at AS updatedAt
      FROM store_vendor_overrides
      WHERE (@storeId IS NULL OR store_id=@storeId)
        AND (@vendorId IS NULL OR vendor_id=@vendorId)
      ORDER BY store_id, vendor_id
      `)
            .all({ storeId, vendorId });
        res.json({ ok: true, rows });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
exports.master.post("/store-vendor-overrides/upsert", (req, res) => {
    try {
        const body = (req.body ?? {});
        const storeId = id_1.ID.store(body.storeId ?? "");
        const vendorId = id_1.ID.vendor(body.vendorId ?? "");
        if (!storeId || !vendorId)
            return res.status(400).json({ ok: false, error: "storeId/vendorId is required" });
        // 既存読み（部分更新）
        const existing = db_1.db
            .prepare(`SELECT * FROM store_vendor_overrides WHERE store_id=@storeId AND vendor_id=@vendorId`)
            .get({ storeId, vendorId });
        const base = existing ?? { store_id: storeId, vendor_id: vendorId };
        const setDay = (d) => {
            const D = d.charAt(0).toUpperCase() + d.slice(1);
            const o = parseOrderable(pick(body, `orderable${D}Override`), true);
            const c = parseCutoffHHMM(pick(body, `cutoffHhmm${D}Override`), true);
            const l = parseLeadTimeDays(pick(body, `leadTimeDays${D}Override`), true);
            if (o !== undefined)
                base[`orderable_${d}_override`] = o;
            if (c !== undefined)
                base[`cutoff_hhmm_${d}_override`] = c;
            if (l !== undefined)
                base[`lead_time_days_${d}_override`] = l;
            // 指定された値だけ個別に validate（nullはOK）
            const oo = base[`orderable_${d}_override`];
            const cc = base[`cutoff_hhmm_${d}_override`];
            const ll = base[`lead_time_days_${d}_override`];
            if (!(oo === null || oo === 0 || oo === 1))
                throw new Error(`orderable_${d}_override must be null/0/1`);
            if (!(cc === null || isHHMM(String(cc))))
                throw new Error(`cutoff_hhmm_${d}_override must be null or HH:MM`);
            if (!(ll === null || (Number.isInteger(ll) && ll >= 0)))
                throw new Error(`lead_time_days_${d}_override must be null or integer >= 0`);
        };
        DAYS.forEach(setDay);
        db_1.db.prepare(`
      INSERT INTO store_vendor_overrides (
        store_id, vendor_id,

        orderable_sun_override, cutoff_hhmm_sun_override, lead_time_days_sun_override,
        orderable_mon_override, cutoff_hhmm_mon_override, lead_time_days_mon_override,
        orderable_tue_override, cutoff_hhmm_tue_override, lead_time_days_tue_override,
        orderable_wed_override, cutoff_hhmm_wed_override, lead_time_days_wed_override,
        orderable_thu_override, cutoff_hhmm_thu_override, lead_time_days_thu_override,
        orderable_fri_override, cutoff_hhmm_fri_override, lead_time_days_fri_override,
        orderable_sat_override, cutoff_hhmm_sat_override, lead_time_days_sat_override,

        updated_at
      ) VALUES (
        @store_id, @vendor_id,

        @orderable_sun_override, @cutoff_hhmm_sun_override, @lead_time_days_sun_override,
        @orderable_mon_override, @cutoff_hhmm_mon_override, @lead_time_days_mon_override,
        @orderable_tue_override, @cutoff_hhmm_tue_override, @lead_time_days_tue_override,
        @orderable_wed_override, @cutoff_hhmm_wed_override, @lead_time_days_wed_override,
        @orderable_thu_override, @cutoff_hhmm_thu_override, @lead_time_days_thu_override,
        @orderable_fri_override, @cutoff_hhmm_fri_override, @lead_time_days_fri_override,
        @orderable_sat_override, @cutoff_hhmm_sat_override, @lead_time_days_sat_override,

        datetime('now')
      )
      ON CONFLICT(store_id, vendor_id) DO UPDATE SET
        orderable_sun_override=excluded.orderable_sun_override,
        cutoff_hhmm_sun_override=excluded.cutoff_hhmm_sun_override,
        lead_time_days_sun_override=excluded.lead_time_days_sun_override,

        orderable_mon_override=excluded.orderable_mon_override,
        cutoff_hhmm_mon_override=excluded.cutoff_hhmm_mon_override,
        lead_time_days_mon_override=excluded.lead_time_days_mon_override,

        orderable_tue_override=excluded.orderable_tue_override,
        cutoff_hhmm_tue_override=excluded.cutoff_hhmm_tue_override,
        lead_time_days_tue_override=excluded.lead_time_days_tue_override,

        orderable_wed_override=excluded.orderable_wed_override,
        cutoff_hhmm_wed_override=excluded.cutoff_hhmm_wed_override,
        lead_time_days_wed_override=excluded.lead_time_days_wed_override,

        orderable_thu_override=excluded.orderable_thu_override,
        cutoff_hhmm_thu_override=excluded.cutoff_hhmm_thu_override,
        lead_time_days_thu_override=excluded.lead_time_days_thu_override,

        orderable_fri_override=excluded.orderable_fri_override,
        cutoff_hhmm_fri_override=excluded.cutoff_hhmm_fri_override,
        lead_time_days_fri_override=excluded.lead_time_days_fri_override,

        orderable_sat_override=excluded.orderable_sat_override,
        cutoff_hhmm_sat_override=excluded.cutoff_hhmm_sat_override,
        lead_time_days_sat_override=excluded.lead_time_days_sat_override,

        updated_at=datetime('now')
      `).run(base);
        res.json({ ok: true, storeId, vendorId });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
function isYmd2(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
/** vendor_items 一覧（vendorId/itemId/asOf は任意） */
exports.master.get("/vendor-items", (req, res) => {
    try {
        const vendorId = req.query.vendorId ? id_1.ID.vendor(String(req.query.vendorId)) : null;
        const itemId = req.query.itemId ? id_1.ID.item(String(req.query.itemId)) : null;
        const asOfRaw = req.query.asOf ? String(req.query.asOf).trim() : null;
        const asOf = asOfRaw && isYmd2(asOfRaw) ? asOfRaw : null;
        const rows = db_1.db
            .prepare(`
        SELECT
          id,
          vendor_id  AS vendorId,
          item_id    AS itemId,
          valid_from AS validFrom,
          valid_to   AS validTo
        FROM vendor_items
        WHERE (@vendorId IS NULL OR vendor_id=@vendorId)
          AND (@itemId   IS NULL OR item_id=@itemId)
          AND valid_from <= COALESCE(@asOf, date('now','localtime'))
          AND (valid_to IS NULL OR valid_to >= COALESCE(@asOf, date('now','localtime')))
        ORDER BY vendor_id, item_id, valid_from
        `)
            .all({ vendorId, itemId, asOf });
        res.json({ ok: true, rows });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
/**
 * vendor_items 現行入替（replace-current）
 * body: { vendorId, validFrom, itemIds: string[] }
 *
 * - 現行（valid_to IS NULL）を validFrom の前日で閉じる
 * - validFrom 以降の「未閉じ」データ（未来分など）があれば削除して入替
 * - 新しい現行セットを validFrom で INSERT
 */
exports.master.post("/vendor-items/replace-current", (req, res) => {
    try {
        const body = (req.body ?? {});
        const vendorId = id_1.ID.vendor(String(body.vendorId ?? ""));
        const validFrom = String(body.validFrom ?? "").trim();
        const itemIdsRaw = Array.isArray(body.itemIds) ? body.itemIds : [];
        if (!vendorId)
            return res.status(400).json({ ok: false, error: "vendorId is required" });
        if (!isYmd2(validFrom))
            return res.status(400).json({ ok: false, error: "validFrom must be YYYY-MM-DD" });
        const itemIds = itemIdsRaw
            .map((x) => id_1.ID.item(String(x ?? "")))
            .filter((x) => !!x);
        // 重複除去
        const uniq = Array.from(new Set(itemIds));
        if (uniq.length === 0) {
            return res.status(400).json({ ok: false, error: "itemIds is required (non-empty)" });
        }
        // 存在チェック：vendor
        const v = db_1.db.prepare(`SELECT 1 FROM vendors WHERE id=?`).get(vendorId);
        if (!v)
            return res.status(400).json({ ok: false, error: `vendor not found: ${vendorId}` });
        // 存在チェック：items（IN でまとめて）
        const placeholders = uniq.map(() => "?").join(",");
        const foundItems = db_1.db
            .prepare(`SELECT id FROM items WHERE id IN (${placeholders})`)
            .all(...uniq);
        if (foundItems.length !== uniq.length) {
            const foundSet = new Set(foundItems.map((r) => r.id));
            const missing = uniq.filter((id) => !foundSet.has(id));
            return res.status(400).json({ ok: false, error: `items not found: ${missing.join(",")}` });
        }
        const tx = db_1.db.transaction(() => {
            // 既に「validFrom & 現行」が完全一致なら no-op
            const cur = db_1.db
                .prepare(`
          SELECT item_id AS itemId
          FROM vendor_items
          WHERE vendor_id=@vendorId
            AND valid_to IS NULL
            AND valid_from=@validFrom
          ORDER BY item_id
          `)
                .all({ vendorId, validFrom });
            if (cur.length === uniq.length) {
                const curSet = new Set(cur.map((r) => r.itemId));
                let same = true;
                for (const id of uniq) {
                    if (!curSet.has(id)) {
                        same = false;
                        break;
                    }
                }
                if (same)
                    return { ok: true, vendorId, validFrom, count: uniq.length, noOp: true };
            }
            // 1) 現行を閉じる（valid_from < validFrom のもの）
            db_1.db.prepare(`
        UPDATE vendor_items
           SET valid_to = date(@validFrom, '-1 day')
         WHERE vendor_id=@vendorId
           AND valid_to IS NULL
           AND valid_from < @validFrom
        `).run({ vendorId, validFrom });
            // 2) validFrom 以降にぶら下がる未閉じデータ（未来・同日再編集など）を消す
            db_1.db.prepare(`
        DELETE FROM vendor_items
         WHERE vendor_id=@vendorId
           AND valid_to IS NULL
           AND valid_from >= @validFrom
        `).run({ vendorId, validFrom });
            // 3) 新しい現行セットを INSERT
            const ins = db_1.db.prepare(`
        INSERT INTO vendor_items (vendor_id, item_id, valid_from, valid_to)
        VALUES (@vendorId, @itemId, @validFrom, NULL)
        `);
            for (const itemId of uniq) {
                ins.run({ vendorId, itemId, validFrom });
            }
            return { ok: true, vendorId, validFrom, count: uniq.length, noOp: false };
        });
        const r = tx();
        res.json(r);
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
/** vendor_items CSV */
exports.master.get("/vendor-items.csv", (req, res) => {
    try {
        const vendorId = req.query.vendorId ? id_1.ID.vendor(String(req.query.vendorId)) : null;
        const rows = db_1.db
            .prepare(`
        SELECT
          vi.vendor_id  AS vendorId,
          v.name        AS vendorName,
          vi.item_id    AS itemId,
          i.name        AS itemName,
          vi.valid_from AS validFrom,
          vi.valid_to   AS validTo
        FROM vendor_items vi
        LEFT JOIN vendors v ON v.id = vi.vendor_id
        LEFT JOIN items   i ON i.id = vi.item_id
        WHERE (@vendorId IS NULL OR vi.vendor_id=@vendorId)
        ORDER BY vi.vendor_id, vi.item_id, vi.valid_from
        `)
            .all({ vendorId });
        const dateStyle = csvDateStyleFromQuery(req.query.dateStyle);
        const lines = [["vendorId", "vendorName", "itemId", "itemName", "validFrom", "validTo"]];
        for (const r of rows) {
            lines.push([
                r.vendorId ?? "",
                r.vendorName ?? "",
                r.itemId ?? "",
                r.itemName ?? "",
                formatDateForCsv(r.validFrom ?? "", dateStyle),
                formatDateForCsv(r.validTo ?? "", dateStyle),
            ]);
        }
        const csv = lines.map((row) => row.map((x) => JSON.stringify(String(x ?? ""))).join(",")).join("\n");
        sendCsv(res, "vendor_items.csv", csv);
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
// === store_vendor_items 管理（期間管理）========================================
// GET /master/store-vendor-items?storeId=&vendorId=&asOf=YYYY-MM-DD
exports.master.get("/store-vendor-items", (req, res) => {
    try {
        const storeId = req.query.storeId ? id_1.ID.store(String(req.query.storeId)) : null;
        const vendorId = req.query.vendorId ? id_1.ID.vendor(String(req.query.vendorId)) : null;
        const asOf = req.query.asOf ? String(req.query.asOf).trim() : null;
        if (asOf && !isYmd(asOf)) {
            return res.status(400).json({ ok: false, error: "asOf must be YYYY-MM-DD" });
        }
        const rows = db_1.db.prepare(`
      SELECT
        svi.id AS id,
        svi.store_id  AS storeId,
        svi.vendor_id AS vendorId,
        svi.item_id   AS itemId,
        svi.valid_from AS validFrom,
        svi.valid_to   AS validTo,

        i.name AS itemName,
        i.spec AS spec,
        i.unit AS unit,
        i.temp_zone AS tempZone
      FROM store_vendor_items svi
      JOIN items i ON i.id = svi.item_id
      WHERE (@storeId IS NULL OR svi.store_id=@storeId)
        AND (@vendorId IS NULL OR svi.vendor_id=@vendorId)
        AND (
          @asOf IS NULL OR (
            svi.valid_from <= @asOf
            AND (svi.valid_to IS NULL OR @asOf <= svi.valid_to)
          )
        )
      ORDER BY svi.store_id, svi.vendor_id, svi.valid_from, svi.item_id
      `).all({ storeId, vendorId, asOf });
        res.json({ ok: true, rows });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
// POST /master/store-vendor-items/replace-current
// body: { storeId, vendorId, validFrom, itemIds: string[] }
// 仕様：
// - validFrom 以降の未来行は削除
// - validFrom にかかる現行行は valid_to = validFrom-1日 にして閉じる
// - validFrom からの現行セットを作る（valid_to NULL）
// - vendor_items の現行（validFrom時点）に含まれない itemId は 400 で弾く
exports.master.post("/store-vendor-items/replace-current", (req, res) => {
    try {
        const body = (req.body ?? {});
        const storeId = id_1.ID.store(body.storeId ?? "");
        const vendorId = id_1.ID.vendor(body.vendorId ?? "");
        const validFrom = String(body.validFrom ?? "").trim();
        const itemIdsRaw = Array.isArray(body.itemIds) ? body.itemIds : [];
        if (!storeId || !vendorId) {
            return res.status(400).json({ ok: false, error: "storeId/vendorId is required" });
        }
        if (!isYmd(validFrom)) {
            return res.status(400).json({ ok: false, error: "validFrom must be YYYY-MM-DD" });
        }
        const itemIds = itemIdsRaw
            .map((x) => String(id_1.ID.item(String(x ?? "")))) // ★ ここで string に確定
            .filter((s) => s.length > 0); // ★ s: string を明示
        if (itemIds.length === 0) {
            return res.status(400).json({ ok: false, error: "itemIds must not be empty" });
        }
        // vendor_items（validFrom 時点の現行）に存在する itemId だけ許可
        const allowed = db_1.db.prepare(`
      SELECT DISTINCT item_id AS itemId
      FROM vendor_items
      WHERE vendor_id=@vendorId
        AND valid_from <= @asOf
        AND (valid_to IS NULL OR @asOf <= valid_to)
      `).all({ vendorId, asOf: validFrom });
        const allowedSet = new Set(allowed.map(r => r.itemId));
        const denied = itemIds.filter((id) => !allowedSet.has(id)); // ★ (id: string) を明示
        if (denied.length > 0) {
            return res.status(400).json({
                ok: false,
                error: `some itemIds are not in vendor_items(asOf=${validFrom})`,
                denied,
            });
        }
        const tx = db_1.db.transaction(() => {
            // 現行セット（validFrom時点）
            const cur = db_1.db.prepare(`
        SELECT item_id AS itemId
        FROM store_vendor_items
        WHERE store_id=@storeId AND vendor_id=@vendorId
          AND valid_from <= @asOf
          AND (valid_to IS NULL OR @asOf <= valid_to)
        `).all({ storeId, vendorId, asOf: validFrom });
            const curSet = new Set(cur.map(r => r.itemId));
            const nextSet = new Set(itemIds);
            const same = curSet.size === nextSet.size &&
                itemIds.every((id) => curSet.has(id)); // ★ (id: string) を明示
            // const same =
            //   curSet.size === nextSet.size &&
            //   itemIds.every(id => curSet.has(id));
            // validFrom 以降に “別の未来行” があるか（同一validFromセットだけなら noOp 可能）
            const future = db_1.db.prepare(`
        SELECT item_id AS itemId, valid_from AS validFrom
        FROM store_vendor_items
        WHERE store_id=@storeId AND vendor_id=@vendorId
          AND valid_from >= @validFrom
        `).all({ storeId, vendorId, validFrom });
            const futureIsOnlySameValidFrom = future.length === itemIds.length &&
                future.every(r => r.validFrom === validFrom && nextSet.has(r.itemId));
            if (same && futureIsOnlySameValidFrom) {
                return { noOp: true, count: itemIds.length };
            }
            // validFrom 以降の未来行は削除（同日も含む）
            db_1.db.prepare(`DELETE FROM store_vendor_items WHERE store_id=@storeId AND vendor_id=@vendorId AND valid_from >= @validFrom`).run({ storeId, vendorId, validFrom });
            // validFrom にかかる現行行を閉じる（validFrom-1日）
            db_1.db.prepare(`
        UPDATE store_vendor_items
           SET valid_to = date(@validFrom, '-1 day')
         WHERE store_id=@storeId AND vendor_id=@vendorId
           AND valid_from < @validFrom
           AND (valid_to IS NULL OR valid_to >= @validFrom)
        `).run({ storeId, vendorId, validFrom });
            // 新セットを投入（validFromから現行）
            const ins = db_1.db.prepare(`
        INSERT INTO store_vendor_items (store_id, vendor_id, item_id, valid_from, valid_to)
        VALUES (@storeId, @vendorId, @itemId, @validFrom, NULL)
        `);
            for (const itemId of itemIds) {
                ins.run({ storeId, vendorId, itemId, validFrom });
            }
            return { noOp: false, count: itemIds.length };
        });
        const r = tx();
        res.json({ ok: true, storeId, vendorId, validFrom, ...r });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
// GET /master/store-vendor-items.csv?storeId=&vendorId=&asOf=
exports.master.get("/store-vendor-items.csv", (req, res) => {
    try {
        const storeId = req.query.storeId ? id_1.ID.store(String(req.query.storeId)) : null;
        const vendorId = req.query.vendorId ? id_1.ID.vendor(String(req.query.vendorId)) : null;
        const asOf = req.query.asOf ? String(req.query.asOf).trim() : null;
        if (asOf && !isYmd(asOf)) {
            return res.status(400).json({ ok: false, error: "asOf must be YYYY-MM-DD" });
        }
        const rows = db_1.db.prepare(`
      SELECT
        svi.store_id  AS storeId,
        st.name      AS storeName,
        svi.vendor_id AS vendorId,
        v.name       AS vendorName,
        svi.item_id  AS itemId,
        i.name       AS itemName,
        i.spec       AS spec,
        i.unit       AS unit,
        i.temp_zone  AS tempZone,
        svi.valid_from AS validFrom,
        svi.valid_to   AS validTo
      FROM store_vendor_items svi
      LEFT JOIN stores st ON st.id = svi.store_id
      LEFT JOIN vendors v ON v.id = svi.vendor_id
      LEFT JOIN items i ON i.id = svi.item_id
      WHERE (@storeId IS NULL OR svi.store_id=@storeId)
        AND (@vendorId IS NULL OR svi.vendor_id=@vendorId)
        AND (
          @asOf IS NULL OR (
            svi.valid_from <= @asOf
            AND (svi.valid_to IS NULL OR @asOf <= svi.valid_to)
          )
        )
      ORDER BY svi.store_id, svi.vendor_id, svi.valid_from, svi.item_id
      `).all({ storeId, vendorId, asOf });
        const dateStyle = csvDateStyleFromQuery(req.query.dateStyle);
        const esc = (v) => {
            const s = v == null ? "" : String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [];
        lines.push([
            "storeId", "storeName", "vendorId", "vendorName", "itemId", "itemName", "spec", "unit", "tempZone", "validFrom", "validTo"
        ].join(","));
        for (const r of rows) {
            lines.push([
                esc(r.storeId), esc(r.storeName),
                esc(r.vendorId), esc(r.vendorName),
                esc(r.itemId), esc(r.itemName),
                esc(r.spec), esc(r.unit), esc(r.tempZone),
                esc(formatDateForCsv(r.validFrom, dateStyle)),
                esc(formatDateForCsv(r.validTo, dateStyle)),
            ].join(","));
        }
        const filename = `store_vendor_items${storeId ? "_" + storeId : ""}${vendorId ? "_" + vendorId : ""}.csv`;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send("\uFEFF" + lines.join("\n"));
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
// === CSV export（運用確認用）====================================
function csvCell(v) {
    if (v === null || v === undefined)
        return "";
    const s = String(v);
    // CSVエスケープ（カンマ/改行/ダブルクォート）
    if (/[",\r\n]/.test(s))
        return `"${s.replace(/"/g, '""')}"`;
    return s;
}
function csvLine(cols) {
    return cols.map(csvCell).join(",");
}
function toCsv(lines) {
    return lines.map(csvLine).join("\r\n") + "\r\n";
}
function sendCsv(res, filename, csv) {
    // Excel向けにBOMを付与（日本語ヘッダ想定）
    const body = "\uFEFF" + csv;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(body);
}
/** vendor_weekly_rules CSV */
exports.master.get("/vendor-weekly-rules.csv", (req, res) => {
    try {
        const vendorId = req.query.vendorId ? id_1.ID.vendor(String(req.query.vendorId)) : null;
        const rows = db_1.db
            .prepare(`
      SELECT
        vendor_id AS vendorId,
        orderable_sun AS orderableSun, cutoff_hhmm_sun AS cutoffHhmmSun, lead_time_days_sun AS leadTimeDaysSun,
        orderable_mon AS orderableMon, cutoff_hhmm_mon AS cutoffHhmmMon, lead_time_days_mon AS leadTimeDaysMon,
        orderable_tue AS orderableTue, cutoff_hhmm_tue AS cutoffHhmmTue, lead_time_days_tue AS leadTimeDaysTue,
        orderable_wed AS orderableWed, cutoff_hhmm_wed AS cutoffHhmmWed, lead_time_days_wed AS leadTimeDaysWed,
        orderable_thu AS orderableThu, cutoff_hhmm_thu AS cutoffHhmmThu, lead_time_days_thu AS leadTimeDaysThu,
        orderable_fri AS orderableFri, cutoff_hhmm_fri AS cutoffHhmmFri, lead_time_days_fri AS leadTimeDaysFri,
        orderable_sat AS orderableSat, cutoff_hhmm_sat AS cutoffHhmmSat, lead_time_days_sat AS leadTimeDaysSat,
        updated_at AS updatedAt
      FROM vendor_weekly_rules
      WHERE (@vendorId IS NULL OR vendor_id=@vendorId)
      ORDER BY vendor_id
      `)
            .all({ vendorId });
        const header = [
            "vendorId",
            "updatedAt",
            "sun_orderable",
            "sun_cutoff",
            "sun_lead",
            "mon_orderable",
            "mon_cutoff",
            "mon_lead",
            "tue_orderable",
            "tue_cutoff",
            "tue_lead",
            "wed_orderable",
            "wed_cutoff",
            "wed_lead",
            "thu_orderable",
            "thu_cutoff",
            "thu_lead",
            "fri_orderable",
            "fri_cutoff",
            "fri_lead",
            "sat_orderable",
            "sat_cutoff",
            "sat_lead",
        ];
        const lines = [header];
        for (const r of rows) {
            lines.push([
                r.vendorId ?? "",
                r.updatedAt ?? "",
                r.orderableSun ?? "",
                r.cutoffHhmmSun ?? "",
                r.leadTimeDaysSun ?? "",
                r.orderableMon ?? "",
                r.cutoffHhmmMon ?? "",
                r.leadTimeDaysMon ?? "",
                r.orderableTue ?? "",
                r.cutoffHhmmTue ?? "",
                r.leadTimeDaysTue ?? "",
                r.orderableWed ?? "",
                r.cutoffHhmmWed ?? "",
                r.leadTimeDaysWed ?? "",
                r.orderableThu ?? "",
                r.cutoffHhmmThu ?? "",
                r.leadTimeDaysThu ?? "",
                r.orderableFri ?? "",
                r.cutoffHhmmFri ?? "",
                r.leadTimeDaysFri ?? "",
                r.orderableSat ?? "",
                r.cutoffHhmmSat ?? "",
                r.leadTimeDaysSat ?? "",
            ]);
        }
        const name = vendorId ? `vendor_weekly_rules_${vendorId}.csv` : "vendor_weekly_rules.csv";
        sendCsv(res, name, toCsv(lines));
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
/** store_vendor_overrides CSV */
exports.master.get("/store-vendor-overrides.csv", (req, res) => {
    try {
        const storeId = req.query.storeId ? id_1.ID.store(String(req.query.storeId)) : null;
        const vendorId = req.query.vendorId ? id_1.ID.vendor(String(req.query.vendorId)) : null;
        const rows = db_1.db
            .prepare(`
      SELECT
        store_id AS storeId,
        vendor_id AS vendorId,

        orderable_sun_override AS orderableSunOverride,
        cutoff_hhmm_sun_override AS cutoffHhmmSunOverride,
        lead_time_days_sun_override AS leadTimeDaysSunOverride,

        orderable_mon_override AS orderableMonOverride,
        cutoff_hhmm_mon_override AS cutoffHhmmMonOverride,
        lead_time_days_mon_override AS leadTimeDaysMonOverride,

        orderable_tue_override AS orderableTueOverride,
        cutoff_hhmm_tue_override AS cutoffHhmmTueOverride,
        lead_time_days_tue_override AS leadTimeDaysTueOverride,

        orderable_wed_override AS orderableWedOverride,
        cutoff_hhmm_wed_override AS cutoffHhmmWedOverride,
        lead_time_days_wed_override AS leadTimeDaysWedOverride,

        orderable_thu_override AS orderableThuOverride,
        cutoff_hhmm_thu_override AS cutoffHhmmThuOverride,
        lead_time_days_thu_override AS leadTimeDaysThuOverride,

        orderable_fri_override AS orderableFriOverride,
        cutoff_hhmm_fri_override AS cutoffHhmmFriOverride,
        lead_time_days_fri_override AS leadTimeDaysFriOverride,

        orderable_sat_override AS orderableSatOverride,
        cutoff_hhmm_sat_override AS cutoffHhmmSatOverride,
        lead_time_days_sat_override AS leadTimeDaysSatOverride,

        updated_at AS updatedAt
      FROM store_vendor_overrides
      WHERE (@storeId IS NULL OR store_id=@storeId)
        AND (@vendorId IS NULL OR vendor_id=@vendorId)
      ORDER BY store_id, vendor_id
      `)
            .all({ storeId, vendorId });
        const header = [
            "storeId",
            "vendorId",
            "updatedAt",
            "sun_orderable_ovr",
            "sun_cutoff_ovr",
            "sun_lead_ovr",
            "mon_orderable_ovr",
            "mon_cutoff_ovr",
            "mon_lead_ovr",
            "tue_orderable_ovr",
            "tue_cutoff_ovr",
            "tue_lead_ovr",
            "wed_orderable_ovr",
            "wed_cutoff_ovr",
            "wed_lead_ovr",
            "thu_orderable_ovr",
            "thu_cutoff_ovr",
            "thu_lead_ovr",
            "fri_orderable_ovr",
            "fri_cutoff_ovr",
            "fri_lead_ovr",
            "sat_orderable_ovr",
            "sat_cutoff_ovr",
            "sat_lead_ovr",
        ];
        const lines = [header];
        for (const r of rows) {
            lines.push([
                r.storeId ?? "",
                r.vendorId ?? "",
                r.updatedAt ?? "",
                r.orderableSunOverride ?? "",
                r.cutoffHhmmSunOverride ?? "",
                r.leadTimeDaysSunOverride ?? "",
                r.orderableMonOverride ?? "",
                r.cutoffHhmmMonOverride ?? "",
                r.leadTimeDaysMonOverride ?? "",
                r.orderableTueOverride ?? "",
                r.cutoffHhmmTueOverride ?? "",
                r.leadTimeDaysTueOverride ?? "",
                r.orderableWedOverride ?? "",
                r.cutoffHhmmWedOverride ?? "",
                r.leadTimeDaysWedOverride ?? "",
                r.orderableThuOverride ?? "",
                r.cutoffHhmmThuOverride ?? "",
                r.leadTimeDaysThuOverride ?? "",
                r.orderableFriOverride ?? "",
                r.cutoffHhmmFriOverride ?? "",
                r.leadTimeDaysFriOverride ?? "",
                r.orderableSatOverride ?? "",
                r.cutoffHhmmSatOverride ?? "",
                r.leadTimeDaysSatOverride ?? "",
            ]);
        }
        const nameParts = [
            "store_vendor_overrides",
            storeId ? `store_${storeId}` : null,
            vendorId ? `vendor_${vendorId}` : null,
        ].filter(Boolean);
        const name = nameParts.join("_") + ".csv";
        sendCsv(res, name, toCsv(lines));
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
// 追加：GET /master/item-prices.csv
// query: vendorId?, itemId?
exports.master.get("/item-prices.csv", (req, res) => {
    try {
        const vendorIdRaw = String(req.query.vendorId ?? "").trim();
        const itemIdRaw = String(req.query.itemId ?? "").trim();
        const vendorId = vendorIdRaw ? vendorIdRaw.replace(/\D/g, "").padStart(6, "0") : null;
        const itemId = itemIdRaw ? itemIdRaw.replace(/\D/g, "").padStart(6, "0") : null;
        const rows = db_1.db
            .prepare(`
        SELECT
          p.id          AS id,
          p.vendor_id   AS vendorId,
          COALESCE(v.name, '') AS vendorName,
          p.item_id     AS itemId,
          COALESCE(i.name, '') AS itemName,
          p.unit_price  AS unitPrice,
          p.valid_from  AS validFrom,
          p.valid_to    AS validTo
        FROM item_prices p
        LEFT JOIN vendors v ON v.id = p.vendor_id
        LEFT JOIN items   i ON i.id = p.item_id
        WHERE (@vendorId IS NULL OR p.vendor_id = @vendorId)
          AND (@itemId   IS NULL OR p.item_id   = @itemId)
        ORDER BY p.vendor_id, p.item_id, p.valid_from, p.id
        `)
            .all({ vendorId, itemId });
        const dateStyle = csvDateStyleFromQuery(req.query.dateStyle);
        const lines = [
            ["vendorId", "vendorName", "itemId", "itemName", "unitPrice", "validFrom", "validTo", "id"],
        ];
        for (const r of rows) {
            lines.push([
                r.vendorId ?? "",
                r.vendorName ?? "",
                r.itemId ?? "",
                r.itemName ?? "",
                r.unitPrice ?? "",
                formatDateForCsv(r.validFrom ?? "", dateStyle),
                formatDateForCsv(r.validTo ?? "", dateStyle),
                r.id ?? "",
            ]);
        }
        const csv = lines
            .map((row) => row.map((x) => JSON.stringify(String(x ?? ""))).join(","))
            .join("\n");
        const ymd = new Date().toISOString().slice(0, 10);
        const suffix = [
            vendorId ? `vendor-${vendorId}` : "allvendors",
            itemId ? `item-${itemId}` : "allitems",
            ymd,
        ].join("_");
        sendCsv(res, `item_prices_${suffix}.csv`, csv);
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
function isTempZone(v) {
    return v === "ambient" || v === "chilled" || v === "frozen";
}
function toNullIfBlank(v) {
    const s = String(v ?? "").trim();
    return s === "" ? null : s;
}
exports.master.post("/items/upsert", (req, res) => {
    try {
        const body = (req.body ?? {});
        const id = id_1.ID.item(String(body.id ?? ""));
        const name = String(body.name ?? "").trim();
        const unit = String(body.unit ?? "").trim();
        const spec = toNullIfBlank(body.spec);
        const tempZoneRaw = String(body.tempZone ?? "").trim() || "ambient";
        const stockUnit = toNullIfBlank(body.stockUnit);
        const stockConvRaw = Number(body.stockConv ?? 1);
        const isActive = Number(body.isActive ?? 1) ? 1 : 0;
        if (!id)
            return res.status(400).json({ ok: false, error: "id is required" });
        if (!name)
            return res.status(400).json({ ok: false, error: "name is required" });
        if (!unit)
            return res.status(400).json({ ok: false, error: "unit is required" });
        if (!isTempZone(tempZoneRaw)) {
            return res.status(400).json({ ok: false, error: "tempZone must be ambient/chilled/frozen" });
        }
        if (!Number.isFinite(stockConvRaw) || stockConvRaw <= 0) {
            return res.status(400).json({ ok: false, error: "stockConv must be number > 0" });
        }
        const exists = db_1.db.prepare(`SELECT 1 FROM items WHERE id=?`).get(id);
        if (exists) {
            db_1.db.prepare(`
        UPDATE items
           SET name=?,
               unit=?,
               spec=?,
               temp_zone=?,
               is_active=?,
               stock_unit=?,
               stock_conv=?
         WHERE id=?
        `).run(name, unit, spec, tempZoneRaw, isActive, stockUnit, stockConvRaw, id);
        }
        else {
            db_1.db.prepare(`
        INSERT INTO items (id, name, unit, spec, temp_zone, is_active, stock_unit, stock_conv)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, name, unit, spec, tempZoneRaw, isActive, stockUnit, stockConvRaw);
        }
        res.json({ ok: true, id });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
exports.master.get("/items.csv", (req, res) => {
    try {
        const includeInactive = String(req.query.includeInactive ?? "1") === "1";
        const rows = db_1.db
            .prepare(`
        SELECT
          id,
          name,
          unit,
          spec,
          temp_zone  AS tempZone,
          is_active  AS isActive,
          stock_unit AS stockUnit,
          stock_conv AS stockConv
        FROM items
        ${includeInactive ? "" : "WHERE is_active = 1"}
        ORDER BY id
        `)
            .all();
        const lines = [
            ["id", "name", "unit", "spec", "tempZone", "isActive", "stockUnit", "stockConv"],
        ];
        for (const r of rows) {
            lines.push([
                r.id ?? "",
                r.name ?? "",
                r.unit ?? "",
                r.spec ?? "",
                r.tempZone ?? "",
                r.isActive ?? "",
                r.stockUnit ?? "",
                r.stockConv ?? "",
            ]);
        }
        const csv = lines
            .map((row) => row.map((x) => JSON.stringify(String(x ?? ""))).join(","))
            .join("\n");
        sendCsv(res, "items.csv", csv);
    }
    catch (e) {
        res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
