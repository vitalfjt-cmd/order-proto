"use strict";
// C:/Users/uchida/js/workspace/order-proto/backend/src/api/inspections.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.inspections = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const id_1 = require("../lib/id");
exports.inspections = (0, express_1.Router)();
class ApiError extends Error {
    constructor(status, body) {
        super(body?.message ?? body?.error ?? "ApiError");
        this.status = status;
        this.body = body;
    }
}
// ===== 検品一覧（期間 From/To 対応版） =====
exports.inspections.get('/inspections', (req, res) => {
    try {
        // ownerType: 'STORE' | 'DC'
        const ownerTypeRaw = typeof req.query.ownerType === 'string' ? req.query.ownerType : 'STORE';
        const ownerType = ownerTypeRaw.toUpperCase() === 'DC' ? 'DC' : 'STORE';
        // クエリから ownerId / vendorId / 期間 From/To を取得
        const ownerIdRaw = typeof req.query.ownerId === 'string' ? req.query.ownerId : '';
        const vendorIdRaw = typeof req.query.vendorId === 'string' ? req.query.vendorId : '';
        const fromRaw = typeof req.query.from === 'string' ? req.query.from : '';
        const toRaw = typeof req.query.to === 'string' ? req.query.to : '';
        const where = [];
        const params = {};
        if (ownerType === 'STORE') {
            // 店舗視点：ownerId を店舗コードとして扱う（4桁ゼロ埋め）
            const ownerId = ownerIdRaw ? id_1.ID.store(ownerIdRaw) : '';
            if (ownerId) {
                where.push('i.owner_id = @ownerId');
                params.ownerId = ownerId;
            }
            // （必要なら）STORE でも vendorId で絞れるようにしておく
            const vendorId = vendorIdRaw ? id_1.ID.vendor(vendorIdRaw) : '';
            if (vendorId) {
                where.push('s.vendor_id = @vendorId');
                params.vendorId = vendorId;
            }
        }
        else {
            // DC視点：ownerId を「ベンダーID」として解釈する
            // vendorId クエリがあれば vendorId を優先、なければ ownerId を vendorId として扱う
            const vendorId = vendorIdRaw
                ? id_1.ID.vendor(vendorIdRaw)
                : ownerIdRaw
                    ? id_1.ID.vendor(ownerIdRaw)
                    : '';
            if (vendorId) {
                where.push('s.vendor_id = @vendorId');
                params.vendorId = vendorId;
            }
            // DC視点では owner_id では絞らない（全店舗分を対象）
        }
        // 納品日（delivery_date）による期間絞り込み
        // ※ 旧実装と同じく shipments.delivery_date ベースで揃えています
        if (fromRaw) {
            where.push('s.delivery_date >= @from');
            params.from = fromRaw;
        }
        if (toRaw) {
            where.push('s.delivery_date <= @to');
            params.to = toRaw;
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        // ===== ヘッダ =====
        const headers = db_1.db
            .prepare(`
        SELECT
          i.id,
          i.shipment_id      AS shipmentId,
          i.owner_id         AS ownerId,
          i.status,
          i.created_at       AS createdAt,
          i.updated_at       AS updatedAt,

          s.vendor_id        AS vendorId,
          s.destination_id   AS destinationId,

          -- ★ JOIN 正：stores.name を優先（shipments.destination_name は古いデータで空があり得る）
          COALESCE(NULLIF(s.destination_name, ''), st.name) AS destinationName,

          s.delivery_date    AS deliveryDate
        FROM inspections i
        JOIN shipments s ON s.id = i.shipment_id
        LEFT JOIN stores st ON st.id = s.destination_id
        ${whereSql}
        ORDER BY s.delivery_date DESC, s.vendor_id, s.destination_id, i.id
        `)
            .all(params)
            .map((r) => ({
            id: r.id,
            shipmentId: r.shipmentId,
            ownerId: r.ownerId,
            status: r.status,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            vendorId: r.vendorId,
            destinationId: r.destinationId,
            destinationName: r.destinationName, // ここはそのまま
            deliveryDate: r.deliveryDate,
        }));
        // ===== 明細 =====
        const headerIds = headers.map((h) => h.id);
        let lines = [];
        if (headerIds.length > 0) {
            const inClause = headerIds.map((_, i) => `@id${i}`).join(',');
            const lineParams = { ...params };
            headerIds.forEach((id, i) => {
                lineParams[`id${i}`] = id;
            });
            const rawLines = db_1.db
                .prepare(`
          SELECT
            l.id,
            l.inspection_id AS inspectionId,
            l.item_id       AS itemId,
            l.ship_qty      AS shipQty,
            l.inspected_qty AS inspectedQty,
            l.diff_qty      AS diffQty,
            l.unit          AS unit,
            l.spec          AS spec,
            l.temp_zone     AS tempZone,
            l.lot_no        AS lotNo,
            l.note          AS note,
            it.name         AS itemName
          FROM inspection_lines l
          LEFT JOIN items it ON it.id = l.item_id
          WHERE l.inspection_id IN (${inClause})
          ORDER BY l.inspection_id, l.id
          `)
                .all(lineParams);
            lines = rawLines;
        }
        res.json({
            headers,
            lines: lines.map((r) => ({
                id: r.id,
                inspectionId: r.inspectionId,
                itemId: r.itemId,
                shipQty: r.shipQty,
                inspectedQty: r.inspectedQty,
                diffQty: r.diffQty,
                unit: r.unit,
                spec: r.spec,
                tempZone: r.tempZone,
                lotNo: r.lotNo,
                note: r.note,
                itemName: r.itemName,
            })),
        });
    }
    catch (e) {
        console.error('[GET /inspections] failed', e);
        res.status(500).json({ error: String(e) });
    }
});
// ===== 出荷 → 検品データ生成 =====
exports.inspections.post('/inspections/generate-from-shipments', (req, res) => {
    const body = (req.body ?? {});
    if (!body.ownerId ||
        !Array.isArray(body.shipmentHeaderIds) ||
        body.shipmentHeaderIds.length === 0) {
        return res
            .status(400)
            .json({ ok: false, error: 'ownerId / shipmentHeaderIds が必要です' });
    }
    const ownerType = body.ownerType ?? 'STORE';
    if (ownerType !== 'STORE') {
        return res
            .status(400)
            .json({ ok: false, error: "現在は ownerType='STORE' のみ対応しています" });
    }
    const ownerId = id_1.ID.store(body.ownerId);
    if (!ownerId) {
        return res.status(400).json({ ok: false, error: 'ownerId が不正です' });
    }
    const shipmentIds = Array.from(new Set(body.shipmentHeaderIds
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0)));
    if (shipmentIds.length === 0) {
        return res.status(400).json({ ok: false, error: 'shipmentHeaderIds が不正です' });
    }
    try {
        // ★ ownerId（店舗）に紐づく shipment のみに絞る（安全策）
        const placeholders = shipmentIds.map(() => '?').join(',');
        const shipments = db_1.db
            .prepare(`
        SELECT
          id,
          vendor_id      AS vendorId,
          destination_id AS destinationId,
          delivery_date  AS deliveryDate,
          status
        FROM shipments
        WHERE id IN (${placeholders})
          AND destination_id = ?
        `)
            .all(...shipmentIds, ownerId);
        if (shipments.length === 0) {
            const result = {
                ok: true,
                createdHeaders: 0,
                createdLines: 0,
                processedShipments: 0,
                skippedShipments: shipmentIds.length,
                skippedNoLines: 0,
            };
            return res.json(result);
        }
        const confirmedShipments = shipments.filter((s) => s.status === 'confirmed');
        if (confirmedShipments.length === 0) {
            const result = {
                ok: true,
                createdHeaders: 0,
                createdLines: 0,
                processedShipments: 0,
                skippedShipments: shipmentIds.length,
                skippedNoLines: 0,
            };
            return res.json(result);
        }
        // ---- tx は1個だけ ----
        const confirmedIds = confirmedShipments.map((s) => s.id);
        const inPlaceholders = confirmedIds.map(() => '?').join(',');
        const tx = db_1.db.transaction(() => {
            let createdHeaders = 0;
            let affectedLines = 0;
            let processedShipments = 0;
            let skippedNoLines = 0;
            // 既存 inspections を拾う（shipment_id -> inspection_id）
            // （owner_id でも絞る：保険）
            const existing = db_1.db
                .prepare(`
          SELECT id, shipment_id AS shipmentId
          FROM inspections
          WHERE shipment_id IN (${inPlaceholders})
            AND owner_id = ?
          `)
                .all(...confirmedIds, ownerId);
            const shipmentIdToInspectionId = new Map();
            for (const row of existing) {
                shipmentIdToInspectionId.set(row.shipmentId, row.id);
            }
            const insertInspection = db_1.db.prepare(`
        INSERT INTO inspections (
          shipment_id,
          owner_id,
          delivery_date,
          status
        )
        VALUES (
          @shipmentId,
          @ownerId,
          @deliveryDate,
          'open'
        )
        `);
            // ★ COUNT(*) をやめて、SELECTして0件判定する
            // ★ amount も持ってくる（「コピー」を明示）
            const selectShipmentLines = db_1.db.prepare(`
        SELECT
          item_id    AS itemId,
          ship_qty   AS shipQty,
          unit_price AS unitPrice,
          amount     AS amount,
          unit,
          spec,
          temp_zone  AS tempZone,
          lot_no     AS lotNo,
          note
        FROM shipment_lines
        WHERE shipment_id = ?
        `);
            const upsertInspectionLine = db_1.db.prepare(`
        INSERT INTO inspection_lines (
          inspection_id,
          item_id,
          ship_qty,
          inspected_qty,
          diff_qty,
          unit,
          spec,
          temp_zone,
          lot_no,
          note,
          unit_price AS unitPrice,
          amount
        )
        VALUES (
          @inspectionId,
          @itemId,
          @shipQty,
          @inspectedQty,
          @diffQty,
          @unit,
          @spec,
          @tempZone,
          @lotNo,
          @note,
          @unitPrice,
          @amount
        )
        ON CONFLICT(inspection_id, item_id) DO UPDATE SET
          ship_qty   = excluded.ship_qty,
          diff_qty   = inspection_lines.inspected_qty - excluded.ship_qty,
          unit       = excluded.unit,
          spec       = excluded.spec,
          temp_zone  = excluded.temp_zone,
          lot_no     = excluded.lot_no,
          note       = excluded.note,
          unit_price = excluded.unit_price,
          amount     = (inspection_lines.inspected_qty * excluded.unit_price),
          updated_at = datetime('now','localtime')
        `);
            const touchInspection = db_1.db.prepare(`
        UPDATE inspections
           SET updated_at = datetime('now','localtime')
         WHERE id = ?
      `);
            for (const s of confirmedShipments) {
                const lines = selectShipmentLines.all(s.id);
                // --- shipment_lines が 0 件なら検品生成しない ---
                if (!lines || lines.length === 0) {
                    skippedNoLines += 1;
                    continue;
                }
                processedShipments += 1;
                let inspectionId = shipmentIdToInspectionId.get(s.id);
                if (!inspectionId) {
                    const r = insertInspection.run({
                        shipmentId: s.id,
                        ownerId,
                        deliveryDate: s.deliveryDate,
                    });
                    if (r.changes && r.changes > 0)
                        createdHeaders += 1;
                    // lastInsertRowid を優先
                    const newId = Number(r.lastInsertRowid);
                    if (Number.isFinite(newId) && newId > 0) {
                        inspectionId = newId;
                    }
                    else {
                        // 念のため SELECT で拾う
                        const row = db_1.db
                            .prepare(`SELECT id FROM inspections WHERE shipment_id = ? AND owner_id = ?`)
                            .get(s.id, ownerId);
                        if (!row)
                            throw new Error(`failed to fetch inspection header for shipment ${s.id}`);
                        inspectionId = row.id;
                    }
                    shipmentIdToInspectionId.set(s.id, inspectionId);
                }
                for (const ln of lines) {
                    const shipQty = Number(ln.shipQty ?? 0);
                    const unitPrice = Number(ln.unitPrice ?? 0);
                    // qty>0 なのに単価が 0/不正なら止める（事故防止）
                    if (shipQty > 0 && (!Number.isFinite(unitPrice) || unitPrice <= 0)) {
                        throw new ApiError(409, {
                            ok: false,
                            error: 'unit_price_missing_on_shipment_line',
                            message: `出荷明細の単価が未設定/不正です（shipment_id=${s.id}, item_id=${ln.itemId}）`,
                            shipmentId: s.id,
                            itemId: ln.itemId,
                            unitPrice: ln.unitPrice,
                        });
                    }
                    const inspectedQty = shipQty; // 初期値は出荷数
                    // ★ amount は shipment_lines の値をコピー（無ければ計算）
                    const amount = Number.isFinite(Number(ln.amount))
                        ? Number(ln.amount)
                        : inspectedQty * unitPrice;
                    const r2 = upsertInspectionLine.run({
                        inspectionId,
                        itemId: ln.itemId,
                        shipQty,
                        inspectedQty,
                        diffQty: 0,
                        unit: ln.unit ?? null,
                        spec: ln.spec ?? null,
                        tempZone: ln.tempZone ?? null,
                        lotNo: ln.lotNo ?? null,
                        note: ln.note ?? null,
                        unitPrice,
                        amount,
                    });
                    if (r2.changes && r2.changes > 0)
                        affectedLines += r2.changes;
                }
                touchInspection.run(inspectionId);
            }
            return { createdHeaders, affectedLines, processedShipments, skippedNoLines };
        });
        const { createdHeaders, affectedLines, processedShipments, skippedNoLines } = tx();
        const skippedShipments = shipmentIds.length - processedShipments;
        const result = {
            ok: true,
            createdHeaders,
            createdLines: affectedLines,
            processedShipments,
            skippedShipments,
            skippedNoLines,
        };
        return res.json(result);
    }
    catch (e) {
        console.error('[/inspections/generate-from-shipments] error:', e);
        if (e && typeof e === 'object' && 'status' in e && 'body' in e) {
            return res.status(e.status).json(e.body);
        }
        return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
});
// ===== 検品ヘッダ＋明細1件取得 =====
exports.inspections.get('/inspections/:id', (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ ok: false, error: 'invalid id' });
        }
        const header = db_1.db
            .prepare(`
        SELECT
          i.id,
          i.shipment_id      AS shipmentId,
          i.owner_id         AS ownerId,
          i.status,
          i.created_at       AS createdAt,
          i.updated_at       AS updatedAt,
          s.vendor_id        AS vendorId,
          s.destination_id   AS destinationId,
          s.destination_name AS destinationName,
          i.delivery_date    AS deliveryDate
        FROM inspections i
        JOIN shipments s ON s.id = i.shipment_id
        WHERE i.id = ?
        `)
            .get(id);
        if (!header) {
            return res.status(404).json({ ok: false, error: 'not found' });
        }
        const lines = db_1.db
            .prepare(`
        SELECT
          il.id,
          il.inspection_id   AS inspectionId,
          il.item_id         AS itemId,
          il.ship_qty        AS shipQty,
          il.inspected_qty   AS inspectedQty,
          il.diff_qty        AS diffQty,
          il.unit,
          il.spec,
          il.temp_zone       AS tempZone,
          il.lot_no          AS lotNo,
          il.note,
          il.created_at      AS createdAt,
          il.updated_at      AS updatedAt,
          it.name            AS itemName
        FROM inspection_lines il
        LEFT JOIN items it ON it.id = il.item_id
        WHERE il.inspection_id = ?
        ORDER BY il.item_id
        `)
            .all(id);
        res.json({ ok: true, header, lines });
    }
    catch (e) {
        console.error('[/inspections/:id] error:', e);
        res
            .status(500)
            .json({ ok: false, error: String(e?.message ?? e) });
    }
});
// ===== 検品明細の保存（数量・ロット・備考） =====
exports.inspections.patch('/inspections/:id/lines', (req, res) => {
    try {
        const inspectionId = Number(req.params.id);
        if (!Number.isFinite(inspectionId)) {
            return res.status(400).json({ ok: false, error: 'invalid id' });
        }
        const body = req.body || {};
        const rawLines = Array.isArray(body.lines) ? body.lines : [];
        const tx = db_1.db.transaction((lines) => {
            const upd = db_1.db.prepare(`
        UPDATE inspection_lines
        SET
          inspected_qty = @inspectedQty,
          diff_qty      = @inspectedQty - ship_qty,
          amount        = @inspectedQty * unit_price,
          lot_no        = @lotNo,
          note          = @note,
          updated_at    = datetime('now','localtime')
        WHERE
          id = @lineId
          AND inspection_id = @inspectionId
        `);
            for (const row of lines) {
                const lineId = Number(row.id ?? row.lineId ?? 0);
                if (!Number.isFinite(lineId))
                    continue;
                const inspectedQty = Number(row.inspectedQty ?? 0);
                const lotNo = row.lotNo != null && row.lotNo !== ''
                    ? String(row.lotNo)
                    : null;
                const note = row.note != null && row.note !== ''
                    ? String(row.note)
                    : null;
                upd.run({
                    inspectionId,
                    lineId,
                    inspectedQty,
                    lotNo,
                    note,
                });
            }
            db_1.db.prepare(`
        UPDATE inspections
        SET updated_at = datetime('now','localtime')
        WHERE id = ?
        `).run(inspectionId);
        });
        tx(rawLines);
        res.json({ ok: true });
    }
    catch (e) {
        console.error('[/inspections/:id/lines] error:', e);
        res
            .status(500)
            .json({ ok: false, error: String(e?.message ?? e) });
    }
});
// ===== 検品 確定 =====
// body: { ids: number[] }
exports.inspections.post('/inspections/confirm', (req, res) => {
    try {
        const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
        // 数値化＋重複排除
        const ids = Array.from(new Set(rawIds
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n) && n > 0)));
        if (ids.length === 0) {
            return res.json({ updated: 0, movements: 0 });
        }
        const tx = db_1.db.transaction((targetIds) => {
            if (targetIds.length === 0) {
                return { updated: 0, movements: 0 };
            }
            const placeholders = targetIds.map(() => '?').join(',');
            const srcRows = db_1.db
                .prepare(`
           SELECT
            i.id            AS inspectionId,
            i.owner_id      AS storeId,
            s.delivery_date AS deliveryDate,
            l.item_id       AS itemId,
            l.inspected_qty AS inspectedQty,
            COALESCE(NULLIF(it.stock_conv, 0), 1.0) AS stockConv,
            l.unit_price                            AS unitPrice
          FROM inspections i
          JOIN shipments s        ON s.id = i.shipment_id
          JOIN inspection_lines l ON l.inspection_id = i.id
          JOIN items it           ON it.id = l.item_id
          WHERE i.id IN (${placeholders})
            AND i.status = 'open'
            AND l.inspected_qty > 0
          `)
                .all(...targetIds);
            const insMove = db_1.db.prepare(`
        INSERT INTO store_stock_movements (
          store_id,
          item_id,
          movement_date,
          movement_type,
          qty,
          ref_type,
          ref_id,
          memo,
          unit_cost,
          amount,
          created_at,
          updated_at
        )
        VALUES (
          @storeId,
          @itemId,
          @movementDate,
          'RECEIPT',
          @qty,
          'inspection',
          @refId,
          NULL,
          @unitCost,
          @amount,
          datetime('now','localtime'),
          datetime('now','localtime')
        )
        `);
            // 0円はOK。NULL/空/非数のみNG
            const missing = srcRows.filter(r => {
                const v = r.unitPrice;
                if (v === null || v === undefined || v === "")
                    return true;
                return !Number.isFinite(Number(v));
            });
            if (missing.length > 0) {
                // どの検品ID・品目が原因か返す（フロントで表示できる）
                const items = Array.from(new Set(missing.map(m => m.itemId))).sort();
                const inspections = Array.from(new Set(missing.map(m => m.inspectionId))).sort((a, b) => a - b);
                return res.status(409).json({
                    ok: false,
                    error: "unit_price_missing",
                    message: "単価未登録の品目があるため、検品確定できません（item_prices を登録してください）。",
                    itemIds: items,
                    inspectionIds: inspections,
                });
            }
            let movements = 0;
            for (const r of srcRows) {
                const inspected = Number(r.inspectedQty ?? 0);
                const conv = Number(r.stockConv ?? 1);
                const stockQty = inspected * conv;
                if (stockQty === 0)
                    continue; // 念のため 0 行はスキップ
                const unitPrice = Number(r.unitPrice ?? 0); // inspection_lines.unit_price
                const unitCost = unitPrice / conv; // 在庫単位単価
                const amount = stockQty * unitCost; // = inspected * unitPrice
                insMove.run({
                    storeId: r.storeId,
                    itemId: r.itemId,
                    movementDate: r.deliveryDate,
                    qty: stockQty, // 在庫単位で記録
                    refId: r.inspectionId,
                    unitCost,
                    amount,
                });
                movements++;
            }
            // 3. ヘッダステータスを open → completed に更新
            const upd = db_1.db
                .prepare(`
          UPDATE inspections
             SET status     = 'completed',
                 updated_at = datetime('now','localtime')
           WHERE id IN (${placeholders})
             AND status = 'open'
          `)
                .run(...targetIds);
            return { updated: upd.changes ?? 0, movements };
        });
        const result = tx(ids);
        res.json(result);
    }
    catch (e) {
        console.error('[/inspections/confirm] error:', e);
        res
            .status(500)
            .json({ ok: false, error: String(e?.message ?? e) });
    }
});
// ===== 検品 監査（audited へ遷移） =====
// body: { ids: number[] }
exports.inspections.post("/inspections/audit", (req, res) => {
    try {
        const ids = Array.isArray(req.body?.ids)
            ? req.body.ids.map((x) => Number(x))
            : [];
        const validIds = ids.filter((x) => Number.isFinite(x));
        if (!validIds.length) {
            return res.json({ updated: 0 });
        }
        const placeholders = validIds.map(() => "?").join(",");
        const sql = `
      UPDATE inspections
         SET status = 'audited',
             updated_at = datetime('now','localtime')
       WHERE id IN (${placeholders})
         AND status = 'completed'
    `;
        const r = db_1.db.prepare(sql).run(...validIds);
        res.json({ updated: r.changes ?? 0 });
    }
    catch (e) {
        console.error("[/inspections/audit] error:", e);
        res
            .status(500)
            .json({ ok: false, error: String(e?.message ?? e) });
    }
});
