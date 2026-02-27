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
  unitCost: number;
  amount: number;
};

// ===================================
// 移動可能品目（在庫>0のもの）: GET /store/shipments/movable-items
//   ?storeId=0002&q=0010 (qは任意: 品目ID前方 or 名称部分一致)
// ===================================
storeShipments.get("/store/shipments/movable-items", (req, res) => {
  try {
    const storeId = req.query.storeId ? ID.store(String(req.query.storeId)) : "";
    if (!storeId) return res.status(400).json({ ok: false, error: "storeId is required" });

    const qRaw = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);

    // 検索条件（無ければ全件）
    // - 数字っぽいなら品目ID前方一致も効かせる
    const q = qRaw.replace(/[%_]/g, ""); // LIKEエスケープ簡易
    const idLike = q ? `${q.replace(/\D/g, "")}%` : "";
    const nameLike = q ? `%${q}%` : "";

    const where: string[] = [
      "it.is_active = 1",
      "b.on_hand > 0",
    ];
    const params: any = { storeId, limit };

    if (q) {
      where.push("(it.id LIKE @idLike OR it.name LIKE @nameLike)");
      params.idLike = idLike || "%";     // 数字が空なら全許容
      params.nameLike = nameLike;
    }

    // on_hand は「在庫単位 qty」を前提（あなたの現仕様）
    // ※ movement_typeの符号は最小で：SHIPMENTだけマイナス、それ以外はプラス扱い
    const sql = `
      WITH bal AS (
        SELECT
          item_id,
          SUM(
            CASE
              WHEN movement_type = 'SHIPMENT' THEN -qty
              WHEN movement_type IN ('RECEIPT','ADJUSTMENT') THEN qty
              ELSE 0
            END
          ) AS on_hand
        FROM store_stock_movements
        WHERE store_id = @storeId
        GROUP BY item_id
      )
      SELECT
        it.id AS itemId,
        it.name AS itemName,
        it.unit AS unit,
        it.stock_unit AS stockUnit,
        it.stock_conv AS stockConv,
        b.on_hand AS onHandQty
      FROM bal b
      JOIN items it ON it.id = b.item_id
      WHERE ${where.join(" AND ")}
      ORDER BY it.id
      LIMIT @limit
    `;

    const rows = db.prepare(sql).all(params) as any[];

    res.json({
      ok: true,
      storeId,
      q: qRaw || null,
      items: rows.map((r) => ({
        itemId: r.itemId,
        itemName: r.itemName,
        onHandQty: Number(r.onHandQty ?? 0),
        unit: r.unit ?? null,
        stockUnit: r.stockUnit ?? null,
        stockConv: Number(r.stockConv ?? 1) || 1,
      })),
    });
  } catch (e: any) {
    console.error("[GET /store/shipments/movable-items] error", e);
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

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

  const slipNoRaw = String(req.query.slipNo || "").trim();
  const slipNo = slipNoRaw.replace(/\D/g, "");
  if (slipNo) {
    // 伝票番号（id）の部分一致検索（例: "12" → id に "12" を含むもの）
    where.push("CAST(id AS TEXT) LIKE @slipNo");
    params.slipNo = `%${slipNo}%`;
  }

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
        l.id,
        l.header_id,
        l.line_no,
        l.item_id,
        l.qty,
        l.unit,
        l.memo,
        l.unit_cost AS unitCost,
        l.amount,
        i.name AS itemName
      FROM store_shipment_lines l
      LEFT JOIN items i ON i.id = l.item_id
      WHERE l.header_id = ?
      ORDER BY l.line_no ASC, l.id ASC
    `
  ).all(header.id) as any[];

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
      itemName: l.itemName ?? null,
      qty: l.qty,
      unit: l.unit ?? null,
      memo: l.memo ?? null,
      unitCost: Number(l.unitCost ?? 0),
      amount: Number(l.amount ?? 0),
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
    let shipmentId = Number(h.id || 0);

    if (shipmentId > 0) {
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
        id: shipmentId,
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
      ).run(shipmentId);
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

      shipmentId = Number(hr.lastInsertRowid);
    }

    // 明細登録の直前に追加
    const itemIds = Array.from(new Set(lines.map(l => l.itemId)));
    const placeholders2 = itemIds.map(() => "?").join(",");

    // itemごとに「最新の unit_cost」を取る（SQLite古めでも動く版）
    const latestCosts = db.prepare(
      `
      SELECT m1.item_id AS itemId, m1.unit_cost AS unitCost
      FROM store_stock_movements m1
      WHERE m1.store_id = ?
        AND m1.item_id IN (${placeholders2})
        AND m1.unit_cost IS NOT NULL
        AND m1.id = (
          SELECT m2.id
          FROM store_stock_movements m2
          WHERE m2.store_id = m1.store_id
            AND m2.item_id = m1.item_id
            AND m2.unit_cost IS NOT NULL
          ORDER BY m2.movement_date DESC, m2.id DESC
          LIMIT 1
        )
      `
    ).all(fromStoreId, ...itemIds) as { itemId: string; unitCost: number }[];

    const costMap = new Map(latestCosts.map(r => [String(r.itemId), Number(r.unitCost)]));

    // unit_cost が取れない品目は 409（= 入庫が無いので移動不可）
    // ★ 0円は意図的にあり得るので「<=0」では弾かない。存在しない/非数だけ弾く。
    const missing = itemIds.filter((id) => {
      if (!costMap.has(id)) return true; // ← これが一番大事（履歴が無い）
      const v = costMap.get(id);
      return v === null || v === undefined || !Number.isFinite(Number(v));
    });

    if (missing.length > 0) {
      const err: any = new Error("unit_cost_missing");
      err.status = 409;
      err.body = {
        ok: false,
        error: "unit_cost_missing",
        message:
          "入庫（単価履歴）が無い品目があるため、店舗移動を保存できません。先に入庫を作ってください。",
        itemIds: missing.sort(),
        fromStoreId,
      };
      throw err;
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
          memo,
          unit_cost AS unitCost,
          amount
        )
        VALUES (
          @shipmentId,
          @lineNo,
          @itemId,
          @qty,
          @unit,
          @memo,
          @unitCost,
          @amount
        )
      `
    );

    lines.forEach((ln, idx) => {
      const unitCost = Number(costMap.get(ln.itemId)); // 0 も許容
      const amount = Number(ln.qty) * unitCost;

      insLine.run({
        shipmentId,
        lineNo: idx + 1,
        itemId: ln.itemId,
        qty: ln.qty,
        unit: ln.unit,
        memo: ln.memo,
        unitCost,
        amount,
      });
    });
    return shipmentId;
  });

  let newId: number;
  try {
    newId = tx() as number;
  } catch (e: any) {
    if (e?.status === 409 && e?.body) {
    return res.status(409).json(e.body);
    }
    console.error('[store_shipments/save] failed', e);
    return res.status(500).json({ error: 'failed to save store shipment' });
  }

  res.json({ ok: true, shipmentId: newId });
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
        unitCost: number | null;
        amount: number | null;
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
            l.qty           AS qty,
            l.unit_cost     AS unitCost,
            l.amount        AS amount
          FROM store_shipments h
          JOIN store_shipment_lines l
            ON l.header_id = h.id
          WHERE h.id IN (${placeholders})
          `
        )
        .all(...shipIds) as MovementSourceRow[];

      // 追加 ここから
      // ★ 保険：NULL/非数だけ弾く（0円は意図的にあり得るので弾かない）
      const missing = srcRows.filter((r) => {
        const uc = r.unitCost;
        const am = r.amount;
        return (
          uc === null ||
          uc === undefined ||
          !Number.isFinite(Number(uc)) ||
          am === null ||
          am === undefined ||
          !Number.isFinite(Number(am))
        );
      });

      if (missing.length > 0) {
        const items = Array.from(new Set(missing.map((m) => m.itemId))).sort();
        return res.status(409).json({
          ok: false,
          error: "unit_cost_missing",
          message:
            "単価/金額が欠損している明細があるため、確定できません。いったん保存し直すか、先に入庫を作ってください。",
          itemIds: items,
        });
      }     
      // 追加 ここまで

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
          unit_cost AS unitCost,
          amount,
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
          @unitCost,
          @amount,
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
          unitCost: r.unitCost,
          amount: r.amount,
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
            unitCost: r.unitCost,
            amount: r.amount,
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