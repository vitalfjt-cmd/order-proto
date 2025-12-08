// backend/src/api/audit.ts

import { Router } from 'express';
import { db } from '../db';

export const audit = Router();

// 起動時にテーブルを用意（なければ作成）
db.exec(`
CREATE TABLE IF NOT EXISTS audit_logs (
  id               TEXT PRIMARY KEY,   -- UUID（フロント生成）
  at               TEXT NOT NULL,      -- ISO文字列
  actor            TEXT NOT NULL,      -- 実行ユーザー
  type             TEXT NOT NULL,      -- shipment.confirm 等
  header_id        TEXT,
  owner_id         TEXT,
  vendor_id        TEXT,
  destination_id   TEXT,
  destination_name TEXT,
  delivery_date    TEXT,
  memo             TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_at
  ON audit_logs(at);

CREATE INDEX IF NOT EXISTS idx_audit_logs_header_id
  ON audit_logs(header_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_vendor
  ON audit_logs(vendor_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_destination
  ON audit_logs(destination_id);
`);

type AuditRow = {
  id: string;
  at: string;
  actor: string;
  type: string;
  header_id: string | null;
  owner_id: string | null;
  vendor_id: string | null;
  destination_id: string | null;
  destination_name: string | null;
  delivery_date: string | null;
  memo: string | null;
};

type AuditEventDto = {
  id: string;
  at: string;
  actor: string;
  type: string;
  headerId: string | null;
  ownerId: string | null;
  vendorId: string | null;
  destinationId: string | null;
  destinationName: string | null;
  deliveryDate: string | null;
  memo: string | null;
};

function rowToDto(r: AuditRow): AuditEventDto {
  return {
    id: r.id,
    at: r.at,
    actor: r.actor,
    type: r.type,
    headerId: r.header_id,
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
audit.post('/events', (req, res) => {
  try {
    const body = req.body as Partial<AuditEventDto> & {
      id: string;
      type: string;
    };

    if (!body.id || !body.type) {
      res.status(400).json({ error: 'id と type は必須です' });
      return;
    }

    const at = body.at || new Date().toISOString();
    const actor = body.actor || 'user';

    db.prepare(
      `
      INSERT INTO audit_logs (
        id, at, actor, type,
        header_id, owner_id, vendor_id,
        destination_id, destination_name,
        delivery_date, memo
      ) VALUES (
        @id, @at, @actor, @type,
        @headerId, @ownerId, @vendorId,
        @destinationId, @destinationName,
        @deliveryDate, @memo
      )
    `
    ).run({
      id: body.id,
      at,
      actor,
      type: body.type,
      headerId: body.headerId ?? null,
      ownerId: body.ownerId ?? null,
      vendorId: body.vendorId ?? null,
      destinationId: body.destinationId ?? null,
      destinationName: body.destinationName ?? null,
      deliveryDate: body.deliveryDate ?? null,
      memo: body.memo ?? null,
    });

    res.json({ ok: true });
  } catch (e: any) {
    console.error('[/audit/events POST] error:', e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// ===== 監査ログ検索 =====
// /audit/events?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&type=...&headerId=...&vendorId=...&destinationId=...
audit.get('/events', (req, res) => {
  try {
    const q = req.query as Record<string, string | undefined>;

    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (q.actor) {
      where.push('actor = @actor');
      params.actor = q.actor;
    }
    if (q.type) {
      where.push('type = @type');
      params.type = q.type;
    }
    if (q.headerId) {
      where.push('header_id = @headerId');
      params.headerId = q.headerId;
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

const rows = db
  .prepare<Record<string, unknown>, AuditRow>(
        `
        SELECT
          id, at, actor, type,
          header_id, owner_id, vendor_id,
          destination_id, destination_name,
          delivery_date, memo
        FROM audit_logs
        ${whereSql}
        ORDER BY at DESC, id DESC
      `
      )
      .all(params);

    const result = rows.map(rowToDto);
    res.json(result);
  } catch (e: any) {
    console.error('[/audit/events GET] error:', e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});
