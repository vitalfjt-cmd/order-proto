"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shipments = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const id_1 = require("../lib/id");
exports.shipments = (0, express_1.Router)();
// ===== 共通ヘルパ =====
function ymd(date) {
    const y = date.getFullYear();
    const m = `${date.getMonth() + 1}`.padStart(2, '0');
    const d = `${date.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
}
// 追加
// 409 などで返すための軽い例外
class ApiError extends Error {
    constructor(status, body) {
        super(body?.message ?? body?.error ?? "ApiError");
        this.status = status;
        this.body = body;
    }
}
// function hasOwn(obj: any, key: string): boolean {
//   return Object.prototype.hasOwnProperty.call(obj, key);
// }
// vendor + item + 日付時点の単価（valid_from/to 対応）
const findUnitPriceAt = db_1.db.prepare(`
  SELECT unit_price AS unitPrice
    FROM item_prices
   WHERE vendor_id = ?
     AND item_id   = ?
     AND valid_from <= ?
     AND (valid_to IS NULL OR valid_to >= ?)
   ORDER BY valid_from DESC
   LIMIT 1
`);
function resolveUnitPriceOrThrow(args) {
    const { vendorId, deliveryDate, shipmentId, line } = args;
    // ① unitPrice が明示されているならそれを採用（0 も尊重）
    const hasUnitPriceProp = hasOwn(line, "unitPrice");
    if (hasUnitPriceProp) {
        const v = line.unitPrice;
        if (v === "" || v == null) {
            // 明示はされているが空：未指定扱いにしてマスタ引きへ
        }
        else {
            const n = Number(v);
            if (!Number.isFinite(n) || n < 0) {
                throw new ApiError(409, {
                    ok: false,
                    error: "unit_price_invalid",
                    message: `単価が不正です（itemId=${line.itemId}）`,
                    shipmentId,
                    vendorId,
                    deliveryDate,
                });
            }
            return n;
        }
    }
    // ② 明示が無い（or 空）ならマスタから引く
    const itemId = String(line.itemId ?? "");
    if (!itemId) {
        throw new ApiError(400, { ok: false, error: "itemId_missing", message: "itemId is required" });
    }
    const row = findUnitPriceAt.get(vendorId, itemId, deliveryDate, deliveryDate);
    const p = row?.unitPrice;
    if (p == null) {
        throw new ApiError(409, {
            ok: false,
            error: "unit_price_missing",
            message: `単価未登録の品目があるため、伝票を保存できません（item_prices を登録してください）。 itemId=${itemId}`,
            shipmentId,
            vendorId,
            deliveryDate,
            itemId,
        });
    }
    return Number(p);
}
// ================================
// shared helpers (camel/snake migration support)
// ================================
function toInt(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
}
function pick(req, keys) {
    for (const k of keys) {
        const v = req.params?.[k] ?? req.query?.[k] ?? req.body?.[k];
        if (v !== undefined && v !== null && String(v) !== "")
            return v;
    }
    return undefined;
}
function pickBody(req) {
    return (req.body ?? {});
}
// ===== 一覧取得 (/shipments) =====
// VendorShipments の検索で利用（snake_case で返す）
exports.shipments.get('/shipments', (req, res) => {
    const df = String(req.query.from || '').slice(0, 10);
    const dt = String(req.query.to || '').slice(0, 10);
    const vendorId = req.query.vendorId ? id_1.ID.vendor(String(req.query.vendorId)) : '';
    const destinationId = req.query.destinationId ? id_1.ID.store(String(req.query.destinationId)) : '';
    const where = [];
    const params = {};
    const shipmentIdRaw = String(req.query.shipmentId || "").trim();
    let shipmentId = null;
    if (shipmentIdRaw) {
        const digits = shipmentIdRaw.replace(/\D/g, "");
        const n = Number(digits);
        if (Number.isFinite(n))
            shipmentId = n;
    }
    if (shipmentId != null) {
        where.push("s.id = @shipmentId");
        params.shipmentId = shipmentId;
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db_1.db.prepare(`
    SELECT
      s.id               AS id,
      COALESCE(s.order_date, s.delivery_date) AS orderDate,
      s.delivery_date    AS deliveryDate,
      s.status           AS status,
      s.vendor_id        AS vendorId,
      v.name             AS vendorName,
      s.destination_id   AS destinationId,
      st.name            AS destinationName,
      s.created_at       AS createdAt,
      s.updated_at       AS updatedAt
    FROM shipments s
    LEFT JOIN vendors v ON v.id = s.vendor_id
    LEFT JOIN stores  st ON st.id = s.destination_id
    ${whereSql}
    ORDER BY s.delivery_date DESC, s.id DESC
    `).all(params);
    // ★ camel のまま返す
    res.json(rows);
});
// ===== 伝票＋明細取得 (/shipments/:id) =====
exports.shipments.get('/shipments/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ error: 'invalid id' });
    const header = db_1.db.prepare(`
    SELECT
      s.id               AS id,
      COALESCE(s.order_date, s.delivery_date) AS orderDate,
      s.delivery_date    AS deliveryDate,
      s.status           AS status,
      s.vendor_id        AS vendorId,
      v.name             AS vendorName,
      s.destination_id   AS destinationId,
      st.name            AS destinationName,
      s.created_at       AS createdAt,
      s.updated_at       AS updatedAt
    FROM shipments s
    LEFT JOIN vendors v ON v.id = s.vendor_id
    LEFT JOIN stores  st ON st.id = s.destination_id
    WHERE s.id = ?
    `).get(id);
    if (!header)
        return res.status(404).json({ error: 'not found' });
    const lines = db_1.db.prepare(`
    SELECT
      l.id            AS id,
      l.shipment_id   AS shipmentId,
      l.item_id       AS itemId,
      it.name         AS itemName,
      l.ordered_qty   AS orderedQty,
      l.ship_qty      AS shipQty,
      l.unit_price    AS unitPrice,
      l.amount        AS amount,
      l.unit          AS unit,
      l.spec          AS spec,
      l.temp_zone     AS tempZone,
      l.lot_no        AS lotNo,
      l.note          AS note
    FROM shipment_lines l
    LEFT JOIN items it ON it.id = l.item_id
    WHERE l.shipment_id = ?
    ORDER BY l.id
    `).all(id);
    res.json({ header, lines }); // ★ camel のまま
});
// ===== 明細のみ (/shipments/:id/lines) =====
exports.shipments.get('/shipments/:id/lines', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ error: 'invalid id' });
    const lines = db_1.db.prepare(`
      SELECT
        l.id            AS id,
        l.shipment_id   AS shipmentId,
        l.item_id       AS itemId,
        it.name         AS itemName,
        l.ordered_qty   AS orderedQty,
        l.ship_qty      AS shipQty,
        l.unit_price    AS unitPrice,
        l.amount        AS amount,
        l.unit          AS unit,
        l.spec          AS spec,
        l.temp_zone     AS tempZone,
        l.lot_no        AS lotNo,
        l.note          AS note
      FROM shipment_lines l
      LEFT JOIN items it ON it.id = l.item_id
      WHERE l.shipment_id = ?
      ORDER BY l.id
    `).all(id);
    // ★ ここが重要：snake へ戻さない
    res.json(lines);
});
// ===== 新規作成 (/shipments/create) =====
exports.shipments.post('/shipments/create', (req, res) => {
    const body = req.body || {};
    const deliveryDate = String(body.deliveryDate || '').slice(0, 10);
    const orderDate = String(body.orderDate || body.deliveryDate || '').slice(0, 10);
    const vendorId = id_1.ID.vendor(String(body.vendorId || ''));
    const destinationId = id_1.ID.store(String(body.destinationId || ''));
    const destinationName = body.destinationName != null && body.destinationName !== ''
        ? String(body.destinationName)
        : null;
    if (!deliveryDate || !vendorId || !destinationId) {
        return res.status(400).json({
            ok: false,
            error: 'deliveryDate, vendorId, destinationId are required',
        });
    }
    const rawLines = Array.isArray(body.lines) ? body.lines : [];
    // 1) ヘッダ作成
    const tx = db_1.db.transaction(() => {
        const hr = db_1.db.prepare(`
      INSERT INTO shipments (
        vendor_id,
        destination_id,
        destination_name,
        delivery_date,
        order_date,
        status,
        created_at,
        updated_at
      )
      VALUES (
        @vendorId,
        @destinationId,
        @destinationName,
        @deliveryDate,
        @orderDate,
        'open',
        datetime('now','localtime'),
        datetime('now','localtime')
      )
      `).run({
            vendorId,
            destinationId,
            destinationName,
            deliveryDate,
            orderDate,
        });
        return Number(hr.lastInsertRowid);
    });
    let newId;
    try {
        newId = tx();
    }
    catch (e) {
        // UNIQUE 制約（同一 vendor/destination/delivery_date で二重作成）
        const msg = String(e?.message ?? e);
        if (msg.includes('UNIQUE constraint failed: shipments.vendor_id, shipments.destination_id, shipments.delivery_date')) {
            return res.status(409).json({
                ok: false,
                error: 'shipment_duplicate',
                message: '同一の納品日・ベンダー・納品先の出荷伝票が既に存在します。',
                vendorId,
                destinationId,
                deliveryDate,
            });
        }
        console.error('[shipments/create] header insert failed', e);
        return res.status(500).json({ ok: false, error: msg });
    }
    // 2) 明細保存（単価解決に失敗したら 409 を返す）
    try {
        if (rawLines.length) {
            replaceLinesInternal(newId, rawLines);
        }
    }
    catch (e) {
        console.error('[shipments/create] replaceLines failed', e);
        // ヘッダだけ残るのを防ぐ
        try {
            db_1.db.prepare(`DELETE FROM shipments WHERE id = ?`).run(newId);
        }
        catch { }
        // ApiError(409) をそのまま返す
        if (e && typeof e === 'object' && 'status' in e && 'body' in e) {
            return res.status(e.status).json(e.body);
        }
        return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
    // 3) 作成結果を返す
    const headerRow = db_1.db.prepare(`
    SELECT
      s.id               AS id,
      s.vendor_id        AS vendorId,
      v.name             AS vendorName,
      s.destination_id   AS destinationId,
      s.destination_name AS destinationName,
      s.delivery_date    AS deliveryDate,
      s.status           AS status,
      s.created_at       AS createdAt,
      s.updated_at       AS updatedAt
    FROM shipments s
    LEFT JOIN vendors v ON v.id = s.vendor_id
    WHERE s.id = ?
    `).get(newId);
    const header = {
        id: String(headerRow.id),
        deliveryDate: headerRow.deliveryDate,
        status: headerRow.status,
        vendorId: headerRow.vendorId,
        vendorName: headerRow.vendorName ?? undefined,
        destinationId: headerRow.destinationId,
        destinationName: headerRow.destinationName ?? undefined,
    };
    return res.status(201).json({ ok: true, header });
});
// ================================
// UPDATE shipment header (core + routes)
// ================================
function updateShipmentHeaderCore(db, shipmentId, body) {
    // camel/snake どちらも拾う
    const status = body.status;
    const orderDate = body.orderDate ?? body.order_date;
    const deliveryDate = body.deliveryDate ?? body.delivery_date;
    const vendorId = body.vendorId ?? body.vendor_id;
    const destinationId = body.destinationId ?? body.destination_id;
    const destinationName = body.destinationName ?? body.destination_name;
    // 既存の制約に合わせて「渡されたものだけ更新」
    const sets = [];
    const params = { id: shipmentId };
    if (status !== undefined) {
        sets.push(`status = @status`);
        params.status = String(status);
    }
    if (orderDate !== undefined) {
        sets.push(`order_date = @orderDate`);
        params.orderDate = String(orderDate);
    }
    if (deliveryDate !== undefined) {
        sets.push(`delivery_date = @deliveryDate`);
        params.deliveryDate = String(deliveryDate);
    }
    if (vendorId !== undefined) {
        sets.push(`vendor_id = @vendorId`);
        params.vendorId = id_1.ID.vendor(String(vendorId));
    }
    if (destinationId !== undefined) {
        sets.push(`destination_id = @destinationId`);
        params.destinationId = id_1.ID.store(String(destinationId));
    }
    if (destinationName !== undefined) {
        sets.push(`destination_name = @destinationName`);
        params.destinationName = destinationName == null ? null : String(destinationName);
    }
    if (sets.length === 0)
        return; // 何も更新しない
    sets.push(`updated_at = datetime('now')`);
    db.prepare(`UPDATE shipments SET ${sets.join(', ')} WHERE id = @id`).run(params);
}
// 新：正ルート（推奨） + vendor 版
exports.shipments.patch(['/shipments/:id', '/vendor/shipments/:id'], (req, res) => {
    const shipmentId = toInt(pick(req, ['id', 'shipmentId']));
    if (!Number.isFinite(shipmentId)) {
        const shipmentId = toInt(pick(req, ['id', 'shipmentId']));
        return res.status(400).json({ ok: false, error: 'invalid shipmentId' });
    }
    updateShipmentHeaderCore(db_1.db, shipmentId, pickBody(req));
    return res.json({ ok: true });
});
function replaceLinesInternal(shipmentId, rows) {
    // ヘッダから vendor_id / delivery_date を取得
    const hdr = db_1.db
        .prepare(`
      SELECT vendor_id AS vendorId, delivery_date AS deliveryDate
        FROM shipments
       WHERE id = ?
      `)
        .get(shipmentId);
    if (!hdr?.vendorId || !hdr?.deliveryDate) {
        throw new ApiError(404, {
            ok: false,
            error: "shipment_not_found",
            message: "出荷ヘッダが見つかりません。",
            shipmentId,
        });
    }
    const vendorId = String(hdr.vendorId);
    const deliveryDate = String(hdr.deliveryDate); // YYYY-MM-DD
    // 単価マスタ参照（deliveryDate 時点）
    const pickUnitPriceStmt = db_1.db.prepare(`
      SELECT p.unit_price AS price
        FROM item_prices p
       WHERE p.vendor_id = ?
         AND p.item_id   = ?
         AND p.valid_from <= ?
         AND (p.valid_to IS NULL OR p.valid_to >= ?)
       ORDER BY p.valid_from DESC
       LIMIT 1
  `);
    function pickUnitPrice(itemId) {
        const row = pickUnitPriceStmt.get(vendorId, itemId, deliveryDate, deliveryDate);
        if (!row || row.price == null)
            return null;
        const n = Number(row.price);
        return Number.isFinite(n) ? n : null;
    }
    const tx = db_1.db.transaction((lines) => {
        db_1.db.prepare(`DELETE FROM shipment_lines WHERE shipment_id = ?`).run(shipmentId);
        if (!lines.length)
            return;
        const ins = db_1.db.prepare(`
      INSERT INTO shipment_lines
        (shipment_id, item_id, ordered_qty, ship_qty, unit_price, amount, unit, spec, temp_zone, lot_no, note)
      VALUES
        (@shipmentId, @itemId, @orderedQty, @shipQty, @unitPrice, @amount, @unit, @spec, @tempZone, @lotNo, @note)
    `);
        const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
        for (const r of lines) {
            // 0) snake を最優先で禁止（ここで止める）
            const snakeKeys = ["item_id", "ship_qty", "unit_price", "lot_no", "temp_zone", "ordered_qty"];
            const usedSnake = snakeKeys.filter((k) => k in (r ?? {}));
            if (usedSnake.length) {
                throw new ApiError(400, {
                    ok: false,
                    error: "snake_case_not_allowed",
                    message: `snake_case keys are not accepted: ${usedSnake.join(", ")}`,
                    shipmentId,
                });
            }
            // 1) itemId 必須：空のまま ID.item に入れない（"000000" 化を防ぐ）
            if (!hasOwn(r, "itemId")) {
                throw new ApiError(400, { ok: false, error: "itemId_missing", message: "itemId is required", shipmentId });
            }
            const itemIdRaw = String(r.itemId ?? "").trim();
            if (!itemIdRaw) {
                throw new ApiError(400, { ok: false, error: "itemId_missing", message: "itemId is required", shipmentId });
            }
            const itemId = id_1.ID.item(itemIdRaw);
            // ID.item が空を "000000" にする実装対策
            if (!itemId || itemId === "000000") {
                throw new ApiError(400, { ok: false, error: "itemId_invalid", message: `itemId is invalid (${itemIdRaw})`, shipmentId });
            }
            const shipQtyProvided = hasOwn(r, "shipQty");
            const rawShipQty = r.shipQty;
            const shipQty = shipQtyProvided && rawShipQty !== "" && rawShipQty != null
                ? Number(rawShipQty)
                : NaN;
            if (!Number.isFinite(shipQty) || shipQty < 0) {
                throw new ApiError(400, {
                    ok: false,
                    error: "shipQty_invalid",
                    message: `shipQty is invalid (itemId=${itemId})`,
                    shipmentId,
                    itemId,
                    shipQty: rawShipQty,
                });
            }
            // orderedQty（任意指定。未指定なら shipQty）
            const orderedQtyProvided = hasOwn(r, "orderedQty");
            const rawOrderedQty = r.orderedQty;
            const orderedQty = orderedQtyProvided && rawOrderedQty !== "" && rawOrderedQty != null
                ? Number(rawOrderedQty)
                : shipQty;
            if (!Number.isFinite(orderedQty) || orderedQty < 0) {
                throw new ApiError(400, {
                    ok: false,
                    error: "orderedQty_invalid",
                    message: `orderedQty is invalid (itemId=${itemId})`,
                    shipmentId,
                    itemId,
                    orderedQty: rawOrderedQty,
                });
            }
            // --- unitPrice 解決（NULLは禁止。解決できなければ 409） ---
            const unitPriceProvided = hasOwn(r, "unitPrice");
            const rawUnitPrice = r.unitPrice;
            let unitPrice;
            if (unitPriceProvided && rawUnitPrice !== "" && rawUnitPrice != null) {
                // 明示指定（0 も尊重）
                const n = Number(rawUnitPrice);
                if (!Number.isFinite(n) || n < 0) {
                    throw new ApiError(409, {
                        ok: false,
                        error: "unit_price_invalid",
                        message: `単価が不正です（itemId=${itemId}）`,
                        shipmentId,
                        vendorId,
                        deliveryDate,
                        itemId,
                        unitPrice: rawUnitPrice,
                    });
                }
                unitPrice = n;
            }
            else {
                // 未指定 → マスタから補完（無ければ 409）
                const up = pickUnitPrice(itemId);
                if (up == null) {
                    throw new ApiError(409, {
                        ok: false,
                        error: "unit_price_missing",
                        message: `単価未登録の品目があるため、伝票を保存できません（item_prices を登録してください）。 itemId=${itemId}`,
                        shipmentId,
                        vendorId,
                        deliveryDate,
                        itemId,
                    });
                }
                unitPrice = up;
            }
            // --- amount 解決（未指定なら自動計算。NULLは禁止） ---
            const amountProvided = hasOwn(r, "amount");
            const rawAmount = r.amount;
            let amount;
            if (amountProvided && rawAmount !== "" && rawAmount != null) {
                const a = Number(rawAmount);
                if (!Number.isFinite(a)) {
                    throw new ApiError(409, {
                        ok: false,
                        error: "amount_invalid",
                        message: `金額が不正です（itemId=${itemId}）`,
                        shipmentId,
                        vendorId,
                        deliveryDate,
                        itemId,
                        amount: rawAmount,
                    });
                }
                amount = a;
            }
            else {
                amount = shipQty * unitPrice;
            }
            ins.run({
                shipmentId,
                itemId,
                orderedQty,
                shipQty,
                unitPrice, // ★必ず number（NOT NULL）
                amount, // ★必ず number（NOT NULL）
                unit: r.unit ?? null,
                spec: r.spec ?? null,
                tempZone: r.tempZone ?? null,
                lotNo: r.lotNo ?? null,
                note: r.note ?? null,
            });
        }
    });
    tx(rows || []);
}
// shipments.ts（replaceLinesInternal の近くに追加）
function replaceShipmentLinesCore(shipmentId, rawLines) {
    // rawLines は camel/snake 混在OK（replaceLinesInternal 側で吸収している想定）
    replaceLinesInternal(shipmentId, rawLines);
}
function handleReplaceLines(req, res) {
    try {
        const shipmentId = Number(req.params?.shipmentId);
        if (!Number.isFinite(shipmentId)) {
            return res.status(400).json({ ok: false, error: "invalid shipmentId" });
        }
        const lines = pickLinesPayload(req);
        if (!lines.length) {
            return res.status(400).json({ ok: false, error: "lines is required" });
        }
        replaceShipmentLinesCore(shipmentId, lines);
        return res.json({ ok: true });
    }
    catch (e) {
        // ★ここを追加：ApiError を status で返す
        if (e && typeof e.status === "number" && e.body) {
            return res.status(e.status).json(e.body);
        }
        console.error("[replaceLines] error:", e);
        return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
}
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function normalizeReplaceLine(shipmentId, r) {
    // 1) snake を最優先で禁止（ここで止める）
    const snakeKeys = ["item_id", "ship_qty", "unit_price", "lot_no", "temp_zone", "ordered_qty"];
    const usedSnake = snakeKeys.filter((k) => k in (r ?? {})); // hasOwn でもOK。in が一番確実
    if (usedSnake.length) {
        throw new ApiError(400, {
            ok: false,
            error: "snake_case_not_allowed",
            message: `snake_case keys are not accepted: ${usedSnake.join(", ")}`,
            shipmentId,
        });
    }
    // 2) itemId は「存在」＋「空じゃない」を保証してから ID.item へ
    if (!hasOwn(r, "itemId")) {
        throw new ApiError(400, {
            ok: false,
            error: "itemId_missing",
            message: "itemId is required",
            shipmentId,
        });
    }
    const itemIdRaw = String(r.itemId ?? "").trim();
    if (!itemIdRaw) {
        throw new ApiError(400, {
            ok: false,
            error: "itemId_missing",
            message: "itemId is required",
            shipmentId,
        });
    }
    const itemId = id_1.ID.item(itemIdRaw);
    // 念のため（ID.item が空を 000000 にする実装対策）
    if (!itemId || itemId === "000000") {
        throw new ApiError(400, {
            ok: false,
            error: "itemId_invalid",
            message: `itemId is invalid (${itemIdRaw})`,
            shipmentId,
        });
    }
    // 3) shipQty も必須（存在しないなら missing を返す）
    if (!hasOwn(r, "shipQty")) {
        throw new ApiError(400, {
            ok: false,
            error: "shipQty_missing",
            message: `shipQty is required (itemId=${itemId})`,
            shipmentId,
            itemId,
        });
    }
    const shipQtyRaw = r.shipQty;
    const shipQty = Number(shipQtyRaw);
    if (!Number.isFinite(shipQty) || shipQty < 0) {
        throw new ApiError(400, {
            ok: false,
            error: "shipQty_invalid",
            message: `shipQty is invalid (itemId=${itemId})`,
            shipmentId,
            itemId,
            shipQty: shipQtyRaw,
        });
    }
    // 4) unitPrice（camelのみ）
    const unitPriceRaw = r.unitPrice;
    const unitPrice = unitPriceRaw == null || unitPriceRaw === "" ? null : Number(unitPriceRaw);
    if (unitPrice != null && !Number.isFinite(unitPrice)) {
        throw new ApiError(400, {
            ok: false,
            error: "unitPrice_invalid",
            message: `unitPrice is invalid (itemId=${itemId})`,
            shipmentId,
            itemId,
            unitPrice: unitPriceRaw,
        });
    }
    const amount = r.amount == null ? null : Number(r.amount);
    const lotNo = String(r.lotNo ?? "");
    const note = r.note == null ? "" : String(r.note);
    return { itemId, shipQty, unitPrice, amount, lotNo, note };
}
function pickLinesPayload(req) {
    const b = req.body ?? {};
    if (Array.isArray(b.lines))
        return b.lines;
    return [];
}
// 正ルート（推奨）
exports.shipments.post([
    "/shipments/:shipmentId/lines/replace",
    "/shipments/:shipmentId/lines/bulk",
    "/vendor/shipments/:shipmentId/lines/replace",
    "/vendor/shipments/:shipmentId/lines/bulk",
], handleReplaceLines);
// ================================
// DELETE shipment line (core + routes)
// ================================
function deleteShipmentLineCore(db, shipmentId, itemId) {
    db.prepare(`DELETE FROM shipment_lines WHERE shipment_id = @shipmentId AND item_id = @itemId`).run({ shipmentId, itemId });
}
// 新：正ルート（推奨） ※厳格化
exports.shipments.delete(['/shipments/:shipmentId/lines/:itemId', '/vendor/shipments/:shipmentId/lines/:itemId'], (req, res) => {
    const shipmentId = Number(req.params?.shipmentId);
    const itemId = id_1.ID.item(String(req.params?.itemId ?? ''));
    if (!Number.isFinite(shipmentId) || !itemId) {
        return res.status(400).json({ ok: false, error: 'invalid shipmentId or itemId' });
    }
    deleteShipmentLineCore(db_1.db, shipmentId, itemId);
    return res.json({ ok: true });
});
// ===== 確定/取消 =====
exports.shipments.post('/shipments/confirm', (req, res) => {
    const ids = Array.isArray(req.body?.ids)
        ? req.body.ids.map((x) => Number(x))
        : [];
    const validIds = ids.filter((x) => Number.isFinite(x));
    if (!validIds.length)
        return res.json({ updated: 0 });
    const q = `
    UPDATE shipments
       SET status = 'confirmed',
           updated_at = datetime('now','localtime')
     WHERE id IN (${validIds.map(() => '?').join(',')})
       AND status = 'open'
  `;
    const r = db_1.db.prepare(q).run(...validIds);
    res.json({ updated: r.changes });
});
exports.shipments.post('/shipments/unconfirm', (req, res) => {
    const ids = Array.isArray(req.body?.ids)
        ? req.body.ids.map((x) => Number(x))
        : [];
    const validIds = ids.filter((x) => Number.isFinite(x));
    if (!validIds.length)
        return res.json({ updated: 0 });
    const q = `
    UPDATE shipments
       SET status = 'open',
           updated_at = datetime('now','localtime')
     WHERE id IN (${validIds.map(() => '?').join(',')})
       AND status = 'confirmed'
  `;
    const r = db_1.db.prepare(q).run(...validIds);
    res.json({ updated: r.changes });
});
function generateShipmentsInternal(params, dryRun) {
    const df = String(params.from || ''); // ← これを「発注日 from」とみなす
    const dt = String(params.to || ''); // ← 「発注日 to」
    const vid = params.vendorId ? id_1.ID.vendor(String(params.vendorId)) : undefined;
    const did = params.destinationId ? id_1.ID.store(String(params.destinationId)) : undefined;
    // const asOf = params.asOf ? String(params.asOf) : '';
    // asOf（基準日時）。指定が無ければ空文字のまま → cutoff 判定をスキップ
    const asOfRaw = params.asOf ? String(params.asOf) : '';
    const asOf = asOfRaw.length >= 16
        ? asOfRaw.replace('T', ' ').slice(0, 16) // 'YYYY-MM-DDTHH:MM:SS' → 'YYYY-MM-DD HH:MM'
        : asOfRaw;
    const sqlBase = `
    WITH base AS (
      SELECT
        o.id         AS orderId,
        o.store_id   AS storeId,
        o.vendor_id  AS headerVendorId,
        o.order_date AS orderDate
      FROM orders o
    ),
    lines AS (
      SELECT
        b.orderId,
        b.storeId,
        COALESCE(ol.vendor_id, b.headerVendorId) AS vendorId,
        b.orderDate,
        ol.item_id AS itemId,
        SUM(ol.qty) AS qty,

        MAX(CASE WHEN ol.unit_price IS NOT NULL AND ol.unit_price > 0 THEN ol.unit_price END) AS unitPriceRaw,

        CASE
          WHEN
            MIN(CASE WHEN ol.unit_price IS NOT NULL AND ol.unit_price > 0 THEN ol.unit_price END)
            IS NOT NULL
            AND
            MIN(CASE WHEN ol.unit_price IS NOT NULL AND ol.unit_price > 0 THEN ol.unit_price END)
            <> MAX(CASE WHEN ol.unit_price IS NOT NULL AND ol.unit_price > 0 THEN ol.unit_price END)
          THEN 1 ELSE 0
        END AS unitPriceInconsistent

      FROM base b
      JOIN order_lines ol ON ol.order_id = b.orderId
      GROUP BY
        b.orderId,
        b.storeId,
        vendorId,
        b.orderDate,
        ol.item_id
    ),
    vw AS (
      SELECT
        l.*,

        -- リードタイム（日数）: 店舗×ベンダー上書き → ベンダー週間ルール
        CASE strftime('%w', l.orderDate)
          WHEN '0' THEN COALESCE((SELECT lead_time_days_sun_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT lead_time_days_sun FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
          WHEN '1' THEN COALESCE((SELECT lead_time_days_mon_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT lead_time_days_mon FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
          WHEN '2' THEN COALESCE((SELECT lead_time_days_tue_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT lead_time_days_tue FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
          WHEN '3' THEN COALESCE((SELECT lead_time_days_wed_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT lead_time_days_wed FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
          WHEN '4' THEN COALESCE((SELECT lead_time_days_thu_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT lead_time_days_thu FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
          WHEN '5' THEN COALESCE((SELECT lead_time_days_fri_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT lead_time_days_fri FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
          WHEN '6' THEN COALESCE((SELECT lead_time_days_sat_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT lead_time_days_sat FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
        END AS lt,

        -- 発注可否（店舗×ベンダー上書き → ベンダー週間ルール）
        CASE strftime('%w', l.orderDate)
          WHEN '0' THEN COALESCE((SELECT orderable_sun_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT orderable_sun FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
          WHEN '1' THEN COALESCE((SELECT orderable_mon_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT orderable_mon FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
          WHEN '2' THEN COALESCE((SELECT orderable_tue_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT orderable_tue FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
          WHEN '3' THEN COALESCE((SELECT orderable_wed_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT orderable_wed FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
          WHEN '4' THEN COALESCE((SELECT orderable_thu_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT orderable_thu FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
          WHEN '5' THEN COALESCE((SELECT orderable_fri_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT orderable_fri FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
          WHEN '6' THEN COALESCE((SELECT orderable_sat_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT orderable_sat FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
        END AS orderable_raw,

        -- 締切時刻（HH:MM）
        CASE strftime('%w', l.orderDate)
          WHEN '0' THEN COALESCE((SELECT cutoff_hhmm_sun_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT cutoff_hhmm_sun FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
          WHEN '1' THEN COALESCE((SELECT cutoff_hhmm_mon_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT cutoff_hhmm_mon FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
          WHEN '2' THEN COALESCE((SELECT cutoff_hhmm_tue_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT cutoff_hhmm_tue FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
          WHEN '3' THEN COALESCE((SELECT cutoff_hhmm_wed_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT cutoff_hhmm_wed FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
          WHEN '4' THEN COALESCE((SELECT cutoff_hhmm_thu_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT cutoff_hhmm_thu FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
          WHEN '5' THEN COALESCE((SELECT cutoff_hhmm_fri_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT cutoff_hhmm_fri FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
          WHEN '6' THEN COALESCE((SELECT cutoff_hhmm_sat_override FROM store_vendor_overrides o WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
                                 (SELECT cutoff_hhmm_sat FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId))
        END AS cutoffHHmm_raw
      FROM lines l
    ),
    resolved AS (
      SELECT
        orderId,
        storeId,
        vendorId,
        orderDate,
        itemId,
        qty,

        unitPriceRaw AS unitPriceRaw,
        unitPriceInconsistent AS unitPriceInconsistent,

        -- ★ 補完：item_prices（orderDate時点で有効な単価）
        (
          SELECT p.unit_price
          FROM item_prices p
          WHERE p.vendor_id = vendorId
            AND p.item_id = itemId
            AND p.valid_from <= orderDate
            AND (p.valid_to IS NULL OR p.valid_to >= orderDate)
          ORDER BY p.valid_from DESC
          LIMIT 1
        ) AS unitPriceMaster,

        -- ★ 最終単価：order_lines → item_prices → 0（0は後段で409にする）
        COALESCE(
          unitPriceRaw,
          (
            SELECT p.unit_price
            FROM item_prices p
            WHERE p.vendor_id = vendorId
              AND p.item_id = itemId
              AND p.valid_from <= orderDate
              AND (p.valid_to IS NULL OR p.valid_to >= orderDate)
            ORDER BY p.valid_from DESC
            LIMIT 1
          ),
          0
        ) AS unitPrice,

        date(orderDate, printf('+%d day', COALESCE(lt, 1))) AS deliveryDate,
        orderable_raw AS orderable,
        cutoffHHmm_raw AS cutoffHHmm,

        CASE
          WHEN COALESCE(cutoffHHmm_raw, '23:59') <= '04:00' THEN
            datetime(orderDate || ' ' || COALESCE(cutoffHHmm_raw, '23:59'), '+1 day')
          ELSE
            datetime(orderDate || ' ' || COALESCE(cutoffHHmm_raw, '23:59'))
        END AS cutoffAt
      FROM vw
    ),
    base_filtered AS (
      SELECT *
      FROM resolved
      WHERE (@df = '' OR orderDate >= @df)
        AND (@dt = '' OR orderDate <= @dt)
        AND (@vid IS NULL OR vendorId = @vid)
        AND (COALESCE(@did,'') = '' OR storeId = @did)
    ),
    diagnostics AS (
      SELECT
        COUNT(*) AS totalBaseLines,
        SUM(CASE WHEN COALESCE(orderable, 1) <> 1 THEN 1 ELSE 0 END) AS excludedNotOrderable,
        SUM(CASE WHEN orderable IS NULL THEN 1 ELSE 0 END) AS missingOrderable,
        SUM(CASE WHEN cutoffHHmm IS NULL THEN 1 ELSE 0 END) AS missingCutoffHHmm,
        SUM(CASE WHEN unitPriceInconsistent = 1 THEN 1 ELSE 0 END) AS inconsistentUnitPrice,
        SUM(
          CASE
            WHEN unitPriceRaw IS NULL
            AND (
              SELECT p.unit_price
              FROM item_prices p
              WHERE p.vendor_id = vendorId
                AND p.item_id = itemId
                AND p.valid_from <= orderDate
                AND (p.valid_to IS NULL OR p.valid_to >= orderDate)
              ORDER BY p.valid_from DESC
              LIMIT 1
            ) IS NULL
            THEN 1 ELSE 0
          END
        ) AS missingUnitPrice,
        SUM(CASE
              WHEN @asOf <> ''
               AND COALESCE(orderable, 1) = 1
               AND cutoffAt > datetime(@asOf)
              THEN 1 ELSE 0
            END) AS excludedBeforeCutoff,
        SUM(CASE
              WHEN COALESCE(orderable, 1) = 1
               AND (@asOf = '' OR cutoffAt <= datetime(@asOf))
              THEN 1 ELSE 0
            END) AS passedLines
      FROM base_filtered
    ),
    filtered AS (
      SELECT *
      FROM base_filtered
      WHERE COALESCE(orderable, 1) = 1
        AND (
          @asOf = ''
          OR cutoffAt <= datetime(@asOf)
        )
    )
  `;
    const src = db_1.db.prepare(`${sqlBase} SELECT * FROM filtered`).all({
        df,
        dt,
        vid: vid ?? null,
        did: did ?? '',
        asOf,
    });
    const diag = db_1.db.prepare(`${sqlBase} SELECT * FROM diagnostics`).get({
        df,
        dt,
        vid: vid ?? null,
        did: did ?? '',
        asOf,
    });
    const reasons = {
        totalBaseLines: Number(diag?.totalBaseLines ?? 0),
        passedLines: Number(diag?.passedLines ?? 0),
        excludedNotOrderable: Number(diag?.excludedNotOrderable ?? 0),
        excludedBeforeCutoff: Number(diag?.excludedBeforeCutoff ?? 0),
        missingUnitPrice: Number(diag?.missingUnitPrice ?? 0),
        missingCutoffHHmm: Number(diag?.missingCutoffHHmm ?? 0),
        missingOrderable: Number(diag?.missingOrderable ?? 0),
    };
    // ひとつも対象が無いなら、preview も 0/0 で返却
    if (!src.length) {
        return {
            ok: true,
            countHeaders: 0,
            countLines: 0,
            headersAffected: 0,
            linesAffected: 0,
            createdHeaders: 0,
            upsertedLines: 0,
            // 新規：スキップ数（確定済みのため生成対象外）
            skippedHeaders: 0,
            skippedLines: 0,
            reasons,
        };
    }
    // 既存出荷（shipments）の状態を確認するクエリ
    const getHeader = db_1.db.prepare(`
    SELECT id, status
      FROM shipments
     WHERE vendor_id      = @vendorId
       AND destination_id = @destinationId
       AND delivery_date  = @deliveryDate
    `);
    // ===== プレビュー（dryRun=true） =====
    if (dryRun) {
        // key: "vendorId|storeId|deliveryDate" -> status ("open" / "confirmed" / "canceled" / "none")
        const headerStatusMap = new Map();
        for (const r of src) {
            const key = `${r.vendorId}|${r.storeId}|${r.deliveryDate}`;
            if (!headerStatusMap.has(key)) {
                const existing = getHeader.get({
                    vendorId: r.vendorId,
                    destinationId: r.storeId,
                    deliveryDate: r.deliveryDate,
                });
                headerStatusMap.set(key, existing?.status ?? "none");
            }
        }
        const effectiveHeaderKeys = new Set();
        let countLines = 0;
        let skippedLines = 0;
        for (const r of src) {
            const key = `${r.vendorId}|${r.storeId}|${r.deliveryDate}`;
            const status = headerStatusMap.get(key) ?? "none";
            // 確定済みヘッダに紐づく明細はプレビューでも「生成対象外」
            if (status === "confirmed") {
                skippedLines++;
                continue;
            }
            countLines++;
            effectiveHeaderKeys.add(key);
        }
        const countHeaders = effectiveHeaderKeys.size;
        const skippedHeaders = headerStatusMap.size - effectiveHeaderKeys.size;
        return {
            ok: true,
            countHeaders,
            countLines,
            headersAffected: countHeaders,
            linesAffected: countLines,
            // 新規：プレビュー時点でスキップされる件数
            skippedHeaders,
            skippedLines,
            // compat（旧UI向け。プレビューでも件数を返す）
            createdHeaders: countHeaders,
            upsertedLines: countLines,
            reasons, // ★追加
        };
    }
    // ===== 本処理：shipments / shipment_lines へ UPSERT =====
    const getStoreName = db_1.db.prepare(`
    SELECT name
      FROM stores
     WHERE id = ?
    `);
    const insHeader = db_1.db.prepare(`
    INSERT INTO shipments (
      vendor_id,
      destination_id,
      destination_name,
      delivery_date,
      order_date,
      status,
      created_at,
      updated_at
    )
    VALUES (
      @vendorId,
      @destinationId,
      @destinationName,
      @deliveryDate,
      @orderDate,
      'open',
      datetime('now','localtime'),
      datetime('now','localtime')
    )
    `);
    const insLine = db_1.db.prepare(`
    INSERT INTO shipment_lines
      (shipment_id, item_id, ordered_qty, ship_qty, unit_price, amount)
    VALUES
    (@shipmentId, @itemId, @qty, @qty, @unitPrice, @amount)
    ON CONFLICT(shipment_id, item_id) DO UPDATE SET
      ordered_qty = excluded.ordered_qty,
      ship_qty    = excluded.ship_qty,
      unit_price  = excluded.unit_price,
      amount      = excluded.amount
    `);
    // 差し替え　カウントの定義を揃えるパッチ start
    let createdHeaders = 0;
    let upsertedLines = 0;
    let skippedHeaders = 0;
    let skippedLines = 0;
    const headerKeyToId = new Map();
    const headerKeyToStatus = new Map();
    const touchedHeaderKeys = new Set(); // ★ 対象になったヘッダキー
    const tx = db_1.db.transaction(() => {
        for (const r of src) {
            const key = `${r.vendorId}|${r.storeId}|${r.deliveryDate}`;
            let shipmentId = headerKeyToId.get(key);
            let status = headerKeyToStatus.get(key);
            if (shipmentId == null) {
                const existing = getHeader.get({
                    vendorId: r.vendorId,
                    destinationId: r.storeId,
                    deliveryDate: r.deliveryDate,
                });
                if (existing?.id) {
                    shipmentId = existing.id;
                    status = existing.status ?? "open";
                }
                else {
                    // 新規ヘッダ作成
                    const store = getStoreName.get(r.storeId);
                    const destinationName = store?.name ?? null;
                    insHeader.run({
                        vendorId: r.vendorId,
                        destinationId: r.storeId,
                        destinationName,
                        orderDate: r.orderDate, // ★ 追加
                        deliveryDate: r.deliveryDate,
                    });
                    createdHeaders++;
                    const h = getHeader.get({
                        vendorId: r.vendorId,
                        destinationId: r.storeId,
                        deliveryDate: r.deliveryDate,
                    });
                    shipmentId = h.id;
                    status = h.status ?? "open";
                }
                headerKeyToId.set(key, shipmentId);
                headerKeyToStatus.set(key, status);
            }
            // ここまで来たら「対象ヘッダ」確定
            touchedHeaderKeys.add(key);
            // 確定済みヘッダは明細も一切いじらない
            if (status === "confirmed") {
                skippedLines++;
                continue;
            }
            const unitPrice = Number(r.unitPrice ?? 0);
            const qty = Number(r.qty ?? 0);
            // ★ 単価混在（想定外）なら止める
            if (Number(r.unitPriceInconsistent ?? 0) === 1) {
                throw new ApiError(409, {
                    ok: false,
                    error: 'unit_price_inconsistent_on_order_lines',
                    message: `同一(伝票・品目)で単価が混在しています（vendor=${r.vendorId}, store=${r.storeId}, orderDate=${r.orderDate}, item=${r.itemId}）`,
                    vendorId: r.vendorId,
                    storeId: r.storeId,
                    orderDate: r.orderDate,
                    itemId: r.itemId,
                    unitPriceRaw: r.unitPriceRaw ?? null,
                    unitPriceMaster: r.unitPriceMaster ?? null,
                });
            }
            // ★ 欠損/0円（qty>0ならNG）
            if (qty > 0 && (!Number.isFinite(unitPrice) || unitPrice <= 0)) {
                throw new ApiError(409, {
                    ok: false,
                    error: 'unit_price_missing_on_generate',
                    message: `単価が未設定/不正です（vendor=${r.vendorId}, store=${r.storeId}, orderDate=${r.orderDate}, item=${r.itemId}）`,
                    vendorId: r.vendorId,
                    storeId: r.storeId,
                    orderDate: r.orderDate,
                    itemId: r.itemId,
                    unitPrice,
                    unitPriceRaw: r.unitPriceRaw ?? null,
                    unitPriceMaster: r.unitPriceMaster ?? null,
                });
            }
            const amount = unitPrice * qty;
            const rr = insLine.run({
                shipmentId,
                itemId: r.itemId,
                qty,
                unitPrice,
                amount,
            });
            upsertedLines += rr.changes;
        }
        // 確定済みヘッダ数
        skippedHeaders = Array.from(headerKeyToStatus.values()).filter((s) => s === "confirmed").length;
    });
    tx();
    const headersAffected = touchedHeaderKeys.size;
    return {
        ok: true,
        headersAffected, // 対象ヘッダ数（既存 + 新規）
        linesAffected: upsertedLines,
        countHeaders: headersAffected,
        countLines: upsertedLines,
        skippedHeaders,
        skippedLines,
        // compat（旧UI向け。将来削除予定）
        createdHeaders, // 純粋な「新規ヘッダ作成数」
        upsertedLines,
    };
}
// ===== 出荷生成（プレビュー） =====
exports.shipments.post('/shipments/generate/preview', (req, res) => {
    try {
        const result = generateShipmentsInternal(req.body ?? {}, true);
        res.json(result);
    }
    catch (e) {
        console.error('[shipments/generate/preview] failed', e);
        // res.status(500).json({ ok: false, error: 'internal_error' });
        res.status(500).json({
            ok: false,
            error: e?.message || String(e),
        });
    }
});
// ===== 出荷生成（本処理） =====
exports.shipments.post('/shipments/generate', (req, res) => {
    try {
        const result = generateShipmentsInternal(req.body ?? {}, false);
        return res.json(result);
    }
    catch (e) {
        console.error('[shipments/generate] failed', e);
        // ★ ApiError をそのまま返す
        if (e && typeof e === 'object' && 'status' in e && 'body' in e) {
            return res.status(e.status).json(e.body);
        }
        return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
});
