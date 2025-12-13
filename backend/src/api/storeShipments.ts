// C:/Users/uchida/js/workspace/order-proto/backend/src/api/storeShipments.ts

import { Router } from 'express';
import { db } from '../db';
import { ID } from '../lib/id';

export const storeShipments = Router();

type MovementType = 'TRANSFER' | 'DISPOSAL';
type StoreShipmentStatus = 'draft' | 'confirmed';

type StoreShipmentHeaderRow = {
  id: number;
  from_store_id: string;
  to_store_id: string | null;
  movement_type: MovementType;
  shipment_date: string;
  status: StoreShipmentStatus;
  memo: string | null;
  created_at: string;
  updated_at: string;
};

type StoreShipmentLineRow = {
  id: number;
  header_id: number;
  line_no: number;
  item_id: string;
  qty: number;
  unit: string | null;
  memo: string | null;
};

// ==============================
// 一覧取得: GET /store/shipments
// ==============================
storeShipments.get('/store/shipments', (req, res) => {
  const storeId = req.query.storeId ? ID.store(String(req.query.storeId)) : '';
  if (!storeId) {
    return res.status(400).json({ error: 'storeId is required' });
  }

  const df = String(req.query.from || '').slice(0, 10);
  const dt = String(req.query.to || '').slice(0, 10);
  const movementTypeRaw = String(req.query.movementType || '').toUpperCase();
  const statusRaw = String(req.query.status || '').toLowerCase();

  const where: string[] = ['from_store_id = @storeId'];
  const params: any = { storeId };

  if (df) {
    where.push('shipment_date >= @df');
    params.df = df;
  }
  if (dt) {
    where.push('shipment_date <= @dt');
    params.dt = dt;
  }
  if (movementTypeRaw === 'TRANSFER' || movementTypeRaw === 'DISPOSAL') {
    where.push('movement_type = @movementType');
    params.movementType = movementTypeRaw as MovementType;
  }
  if (statusRaw === 'draft' || statusRaw === 'confirmed') {
    where.push('status = @status');
    params.status = statusRaw as StoreShipmentStatus;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db.prepare(
    `
      SELECT
        id,
        from_store_id,
        to_store_id,
        movement_type,
        shipment_date,
        status,
        memo,
        created_at,
        updated_at
      FROM store_shipments
      ${whereSql}
      ORDER BY shipment_date DESC, id DESC
    `
  ).all(params) as StoreShipmentHeaderRow[];

  res.json({
    headers: rows.map(h => ({
      id: h.id,
      fromStoreId: h.from_store_id,
      toStoreId: h.to_store_id ?? null,
      movementType: h.movement_type,
      shipmentDate: h.shipment_date,
      status: h.status,
      memo: h.memo ?? null,
      createdAt: h.created_at,
      updatedAt: h.updated_at,
    })),
  });
});

// ==============================
// 単票取得: GET /store/shipments/:id
// ==============================
storeShipments.get('/store/shipments/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }

  const header = db.prepare(
    `
      SELECT
        id,
        from_store_id,
        to_store_id,
        movement_type,
        shipment_date,
        status,
        memo,
        created_at,
        updated_at
      FROM store_shipments
      WHERE id = ?
    `
  ).get(id) as StoreShipmentHeaderRow | undefined;

  if (!header) {
    return res.status(404).json({ error: 'not found' });
  }

  const lines = db.prepare(
    `
      SELECT
        id,
        header_id,
        line_no,
        item_id,
        qty,
        unit,
        memo
      FROM store_shipment_lines
      WHERE header_id = ?
      ORDER BY line_no ASC, id ASC
    `
  ).all(header.id) as StoreShipmentLineRow[];

  res.json({
    header: {
      id: header.id,
      fromStoreId: header.from_store_id,
      toStoreId: header.to_store_id ?? null,
      movementType: header.movement_type,
      shipmentDate: header.shipment_date,
      status: header.status,
      memo: header.memo ?? null,
      createdAt: header.created_at,
      updatedAt: header.updated_at,
    },
    lines: lines.map(l => ({
      id: l.id,
      lineNo: l.line_no,
      itemId: l.item_id,
      qty: l.qty,
      unit: l.unit ?? null,
      memo: l.memo ?? null,
    })),
  });
});

// ===================================
// 保存: POST /store/shipments/save
//  - 新規/更新どちらもこの1本で対応
// ===================================
type SaveHeaderPayload = {
  id?: number | null;
  fromStoreId: string;
  toStoreId?: string | null;
  movementType: MovementType;
  shipmentDate: string;
  memo?: string | null;
};

type SaveLinePayload = {
  id?: number | null;
  lineNo?: number | null;
  itemId: string;
  qty: number;
  unit?: string | null;
  memo?: string | null;
};

type SavePayload = {
  header: SaveHeaderPayload;
  lines: SaveLinePayload[];
};

storeShipments.post('/store/shipments/save', (req, res) => {
  const body: SavePayload = req.body || ({} as any);
  const h = body.header;
  const rawLines = Array.isArray(body.lines) ? body.lines : [];

  if (!h) {
    return res.status(400).json({ error: 'header is required' });
  }

  const fromStoreId = ID.store(String(h.fromStoreId || ''));
  const toStoreId = h.toStoreId ? ID.store(String(h.toStoreId)) : null;
  const movementType = String(h.movementType || '').toUpperCase() as MovementType;
  const shipmentDate = String(h.shipmentDate || '').slice(0, 10);
  const memo = h.memo != null && h.memo !== '' ? String(h.memo) : null;

  if (!fromStoreId || !shipmentDate || (movementType !== 'TRANSFER' && movementType !== 'DISPOSAL')) {
    return res.status(400).json({ error: 'fromStoreId, shipmentDate, movementType are required' });
  }
  if (movementType === 'TRANSFER' && !toStoreId) {
    return res.status(400).json({ error: 'toStoreId is required for TRANSFER' });
  }

  const lines = rawLines
    .map(l => {
      const itemId = ID.item(String(l.itemId || ''));
      const qty = Number(l.qty ?? 0);
      const unit = l.unit != null && l.unit !== '' ? String(l.unit) : null;
      const memo = l.memo != null && l.memo !== '' ? String(l.memo) : null;
      return { itemId, qty, unit, memo };
    })
    .filter(l => l.itemId && Number.isFinite(l.qty) && l.qty > 0);

  if (!lines.length) {
    return res.status(400).json({ error: 'at least one line is required' });
  }

  const tx = db.transaction(() => {
    let headerId = Number(h.id || 0);

    if (headerId > 0) {
      // 既存ヘッダ更新
      db.prepare(
        `
          UPDATE store_shipments
             SET from_store_id  = @fromStoreId,
                 to_store_id    = @toStoreId,
                 movement_type  = @movementType,
                 shipment_date  = @shipmentDate,
                 memo           = @memo,
                 updated_at     = datetime('now','localtime')
           WHERE id = @id
        `
      ).run({
        id: headerId,
        fromStoreId,
        toStoreId,
        movementType,
        shipmentDate,
        memo,
      });

      // 明細は一旦全削除 → 全入れ替え
      db.prepare(
        `
          DELETE FROM store_shipment_lines
           WHERE header_id = ?
        `
      ).run(headerId);
    } else {
      // 新規ヘッダ
      const hr = db.prepare(
        `
          INSERT INTO store_shipments (
            from_store_id,
            to_store_id,
            movement_type,
            shipment_date,
            status,
            memo,
            created_at,
            updated_at
          )
          VALUES (
            @fromStoreId,
            @toStoreId,
            @movementType,
            @shipmentDate,
            'draft',
            @memo,
            datetime('now','localtime'),
            datetime('now','localtime')
          )
        `
      ).run({
        fromStoreId,
        toStoreId,
        movementType,
        shipmentDate,
        memo,
      });

      headerId = Number(hr.lastInsertRowid);
    }

    // 明細登録
    const insLine = db.prepare(
      `
        INSERT INTO store_shipment_lines (
          header_id,
          line_no,
          item_id,
          qty,
          unit,
          memo
        )
        VALUES (
          @headerId,
          @lineNo,
          @itemId,
          @qty,
          @unit,
          @memo
        )
      `
    );

    lines.forEach((ln, idx) => {
      insLine.run({
        headerId,
        lineNo: idx + 1,
        itemId: ln.itemId,
        qty: ln.qty,
        unit: ln.unit,
        memo: ln.memo,
      });
    });

    return headerId;
  });

  let newId: number;
  try {
    newId = tx() as number;
  } catch (e: any) {
    console.error('[store_shipments/save] failed', e);
    return res.status(500).json({ error: 'failed to save store shipment' });
  }

  res.json({ ok: true, headerId: newId });
});

// ===================================
// 確定: POST /store/shipments/confirm
// ===================================
storeShipments.post('/store/shipments/confirm', (req, res) => {
  try {
    const rawIds: any[] = Array.isArray(req.body?.ids) ? req.body.ids : [];

    // 数値化＋重複排除
    const ids = Array.from(
      new Set(
        rawIds
          .map((x) => Number(x))
          .filter((n) => Number.isFinite(n) && n > 0)
      )
    );

    if (ids.length === 0) {
      return res.json({ updated: 0, movements: 0 });
    }

    // まず status = 'draft' のヘッダだけに絞る
    const placeholdersFilter = ids.map(() => '?').join(',');
    const targetRows = db
      .prepare(
        `
        SELECT id
          FROM store_shipments
         WHERE id IN (${placeholdersFilter})
           AND status = 'draft'
        `
      )
      .all(...ids) as { id: number }[];

    const targetIds = targetRows.map((r) => r.id);
    if (targetIds.length === 0) {
      return res.json({ updated: 0, movements: 0 });
    }

    const tx = db.transaction((shipIds: number[]) => {
      if (shipIds.length === 0) {
        return { updated: 0, movements: 0 };
      }

      const placeholders = shipIds.map(() => '?').join(',');

      type MovementSourceRow = {
        shipmentId: number;
        fromStoreId: string;
        toStoreId: string | null;
        movementType: MovementType;
        shipmentDate: string;
        itemId: string;
        qty: number;
      };

      // 1. 対象店舗出荷ヘッダ＋明細を取得
      const srcRows = db
        .prepare(
          `
          SELECT
            h.id            AS shipmentId,
            h.from_store_id AS fromStoreId,
            h.to_store_id   AS toStoreId,
            h.movement_type AS movementType,
            h.shipment_date AS shipmentDate,
            l.item_id       AS itemId,
            l.qty           AS qty
          FROM store_shipments h
          JOIN store_shipment_lines l
            ON l.header_id = h.id
          WHERE h.id IN (${placeholders})
          `
        )
        .all(...shipIds) as MovementSourceRow[];

      // 2. 在庫履歴に入出庫行を INSERT
      const insMove = db.prepare(
        `
        INSERT INTO store_stock_movements (
          store_id,
          item_id,
          movement_date,
          movement_type,
          qty,
          ref_type,
          ref_id,
          memo,
          created_at,
          updated_at
        )
        VALUES (
          @storeId,
          @itemId,
          @movementDate,
          @movementType,
          @qty,
          'store_shipment',
          @refId,
          NULL,
          datetime('now','localtime'),
          datetime('now','localtime')
        )
        `
      );

      let movements = 0;

      for (const r of srcRows) {
        // 出荷元店舗：常に「出庫」
        insMove.run({
          storeId: r.fromStoreId,
          itemId: r.itemId,
          movementDate: r.shipmentDate,
          movementType: 'SHIPMENT',
          qty: r.qty,
          refId: r.shipmentId,
        });
        movements++;

        // 店間移動（TRANSFER）の場合のみ、相手店舗に「入庫」
        if (r.movementType === 'TRANSFER' && r.toStoreId) {
          insMove.run({
            storeId: r.toStoreId,
            itemId: r.itemId,
            movementDate: r.shipmentDate,
            movementType: 'RECEIPT',
            qty: r.qty,
            refId: r.shipmentId,
          });
          movements++;
        }
        // movement_type === 'DISPOSAL' の場合は出荷元のみ（上の1本だけ）で OK
      }

      // 3. ヘッダステータスを draft → confirmed に更新
      const upd = db
        .prepare(
          `
          UPDATE store_shipments
             SET status     = 'confirmed',
                 updated_at = datetime('now','localtime')
           WHERE id IN (${placeholders})
             AND status = 'draft'
          `
        )
        .run(...shipIds);

      return { updated: upd.changes, movements };
    });

    const result = tx(targetIds);
    res.json(result);
  } catch (e: any) {
    console.error('[/store/shipments/confirm] failed:', e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});
// storeShipments.post('/store/shipments/confirm', (req, res) => {
//   const ids: number[] = Array.isArray(req.body?.ids)
//     ? (req.body.ids as any[]).map(x => Number(x))
//     : [];
//   const validIds = ids.filter(x => Number.isFinite(x));
//   if (!validIds.length) return res.json({ updated: 0 });

//   const q = `
//     UPDATE store_shipments
//        SET status = 'confirmed',
//            updated_at = datetime('now','localtime')
//      WHERE id IN (${validIds.map(() => '?').join(',')})
//        AND status = 'draft'
//   `;
//   const r = db.prepare(q).run(...validIds);
//   res.json({ updated: r.changes });
// });
