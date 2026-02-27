"use strict";
// backend/src/api/audit.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.audit = void 0;
const express_1 = require("express");
const db_1 = require("../db");
exports.audit = (0, express_1.Router)();
// 起動時にテーブルを用意（なければ作成）
// 1) create table only
db_1.db.exec(`
CREATE TABLE IF NOT EXISTS audit_logs (
  id               TEXT PRIMARY KEY,
  at               TEXT NOT NULL,
  actor            TEXT NOT NULL,
  type             TEXT NOT NULL,
  shipment_id      TEXT,
  owner_id         TEXT,
  vendor_id        TEXT,
  destination_id   TEXT,
  destination_name TEXT,
  delivery_date    TEXT,
  memo             TEXT,
  inspection_id    TEXT
);
`);
// 3) indexes (no duplicates)
db_1.db.exec(`
CREATE INDEX IF NOT EXISTS idx_audit_logs_at              ON audit_logs(at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_shipment_id     ON audit_logs(shipment_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_inspection_id   ON audit_logs(inspection_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_vendor_id       ON audit_logs(vendor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_destination_id  ON audit_logs(destination_id);
`);
function rowToDto(r) {
    return {
        id: r.id,
        at: r.at,
        actor: r.actor,
        type: r.type,
        shipmentId: r.shipment_id,
        inspectionId: r.inspection_id ?? null,
        ownerId: r.owner_id,
        vendorId: r.vendor_id,
        destinationId: r.destination_id,
        destinationName: r.destination_name,
        deliveryDate: r.delivery_date,
        memo: r.memo,
    };
}
// ===== 監査ログ登録 =====
// フロントの logEvent() から呼ばれる想定
exports.audit.post('/events', (req, res) => {
    try {
        const body = req.body;
        if (!body.id || !body.type) {
            res.status(400).json({ error: 'id と type は必須です' });
            return;
        }
        const at = body.at || new Date().toISOString();
        const actor = body.actor || 'user';
        db_1.db.prepare(`
      INSERT OR IGNORE INTO audit_logs (
        id, at, actor, type,
        shipment_id, owner_id, vendor_id,
        destination_id, destination_name,
        delivery_date, memo, inspection_id
      ) VALUES (
        @id, @at, @actor, @type,
        @shipmentId, @ownerId, @vendorId,
        @destinationId, @destinationName,
        @deliveryDate, @memo, @inspectionId
      )
    `).run({
            id: body.id,
            at,
            actor,
            type: body.type,
            shipmentId: body.shipmentId ?? null,
            ownerId: body.ownerId ?? null,
            vendorId: body.vendorId ?? null,
            destinationId: body.destinationId ?? null,
            destinationName: body.destinationName ?? null,
            deliveryDate: body.deliveryDate ?? null,
            memo: body.memo ?? null,
            inspectionId: body.inspectionId ?? null,
        });
        res.json({ ok: true });
    }
    catch (e) {
        console.error('[/audit/events POST] error:', e);
        res.status(500).json({ error: String(e?.message ?? e) });
    }
});
// ===== 監査ログ検索 =====
// /audit/events?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&type=...&shipmentId=...&vendorId=...&destinationId=...
exports.audit.get('/events', (req, res) => {
    try {
        const q = req.query;
        const where = [];
        const params = {};
        if (q.actor) {
            where.push('actor = @actor');
            params.actor = q.actor;
        }
        if (q.type) {
            where.push('type = @type');
            params.type = q.type;
        }
        if (q.shipmentId) {
            where.push('shipment_id = @shipmentId');
            params.shipmentId = q.shipmentId;
        }
        if (q.inspectionId) {
            where.push('inspection_id = @inspectionId');
            params.inspectionId = q.inspectionId;
        }
        if (q.vendorId) {
            where.push('vendor_id = @vendorId');
            params.vendorId = q.vendorId;
        }
        if (q.destinationId) {
            where.push('destination_id = @destinationId');
            params.destinationId = q.destinationId;
        }
        if (q.dateFrom) {
            // at の YYYY-MM-DD で絞り込み
            where.push("substr(at, 1, 10) >= @dateFrom");
            params.dateFrom = q.dateFrom;
        }
        if (q.dateTo) {
            where.push("substr(at, 1, 10) <= @dateTo");
            params.dateTo = q.dateTo;
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const rows = db_1.db
            .prepare(`
        SELECT
          id, at, actor, type,
          shipment_id, owner_id, vendor_id,
          destination_id, destination_name,
          delivery_date, memo, inspection_id
        FROM audit_logs
        ${whereSql}
        ORDER BY at DESC, id DESC
      `)
            .all(params);
        const result = rows.map(rowToDto);
        res.json(result);
    }
    catch (e) {
        console.error('[/audit/events GET] error:', e);
        res.status(500).json({ error: String(e?.message ?? e) });
    }
});
