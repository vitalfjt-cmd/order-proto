// C:/Users/uchida/js/workspace/order-proto/backend/src/api/inspections.ts

import { Router } from 'express';
import { db } from '../db';
import { ID } from '../lib/id';

export const inspections = Router();

// ===== 型定義 =====

type OwnerType = 'STORE' | 'DC';

type GenerateFromShipmentsPayload = {
  ownerType?: OwnerType;        // 省略時は 'STORE'
  ownerId: string;              // 例: '0004'
  shipmentHeaderIds: number[];  // 対象 shipments.id の配列
};

type GenerateFromShipmentsResult = {
  ok: boolean;
  createdHeaders: number;       // 新規 inspections 件数
  createdLines: number;         // 追加/更新された inspection_lines 行数
  processedShipments: number;   // 処理対象となった出荷ヘッダ数（= confirmed）
  skippedShipments: number;     // 指定されたがスキップされた出荷ヘッダ数
};

// 検品ステータス
type InspectionStatus = "open" | "completed" | "audited";

// /inspections ヘッダ行用（SELECT のエイリアスに合わせる）
type InspectionHeaderRow = {
  id: number;
  shipmentId: number;
  ownerId: string;
  status: string; // DB 上は TEXT として受ける
  createdAt: string;
  updatedAt: string;
  vendorId: string;
  destinationId: string;
  destinationName: string | null;
  deliveryDate: string;
};

// /inspections 明細行用
type InspectionLineRow = {
  id: number;
  inspectionId: number;
  itemId: string;
  shipQty: number;
  inspectedQty: number;
  diffQty: number;
  unit: string | null;
  spec: string | null;
  tempZone: string | null;
  lotNo: string | null;
  note: string | null;
  itemName: string | null;
};


// ===== 検品一覧（期間 From/To 対応版） =====
inspections.get('/inspections', (req, res) => {
  try {
    // ownerType: 'STORE' | 'DC'
    const ownerTypeRaw =
      typeof req.query.ownerType === 'string' ? req.query.ownerType : 'STORE';
    const ownerType: OwnerType =
      ownerTypeRaw.toUpperCase() === 'DC' ? 'DC' : 'STORE';

    // クエリから ownerId / vendorId / 期間 From/To を取得
    const ownerIdRaw =
      typeof req.query.ownerId === 'string' ? req.query.ownerId : '';
    const vendorIdRaw =
      typeof req.query.vendorId === 'string' ? req.query.vendorId : '';

    const fromRaw =
      typeof req.query.from === 'string' ? req.query.from : '';
    const toRaw =
      typeof req.query.to === 'string' ? req.query.to : '';

    const where: string[] = [];
    const params: any = {};

    if (ownerType === 'STORE') {
      // 店舗視点：ownerId を店舗コードとして扱う（4桁ゼロ埋め）
      const ownerId = ownerIdRaw ? ID.store(ownerIdRaw) : '';
      if (ownerId) {
        where.push('i.owner_id = @ownerId');
        params.ownerId = ownerId;
      }

      // （必要なら）STORE でも vendorId で絞れるようにしておく
      const vendorId = vendorIdRaw ? ID.vendor(vendorIdRaw) : '';
      if (vendorId) {
        where.push('s.vendor_id = @vendorId');
        params.vendorId = vendorId;
      }
    } else {
      // DC視点：ownerId を「ベンダーID」として解釈する
      // vendorId クエリがあれば vendorId を優先、なければ ownerId を vendorId として扱う
      const vendorId =
        vendorIdRaw
          ? ID.vendor(vendorIdRaw)
          : ownerIdRaw
          ? ID.vendor(ownerIdRaw)
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
    const headers = db
      .prepare<InspectionHeaderRow, typeof params>(
        `
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
          s.delivery_date    AS deliveryDate
        FROM inspections i
        JOIN shipments s ON s.id = i.shipment_id
        ${whereSql}
        ORDER BY s.delivery_date DESC, s.vendor_id, s.destination_id, i.id
        `
      )
      .all(params)
      .map((r) => ({
        id: r.id,
        shipmentId: r.shipmentId,
        ownerId: r.ownerId,
        status: r.status as InspectionStatus,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        vendorId: r.vendorId,
        destinationId: r.destinationId,
        destinationName: r.destinationName,
        deliveryDate: r.deliveryDate,
      }));

    // ===== 明細 =====
    const headerIds = headers.map((h) => h.id);
    let lines: InspectionLineRow[] = [];
    if (headerIds.length > 0) {
      const inClause = headerIds.map((_, i) => `@id${i}`).join(',');
      const lineParams: any = { ...params };
      headerIds.forEach((id, i) => {
        lineParams[`id${i}`] = id;
      });

      const rawLines = db
        .prepare<InspectionLineRow, typeof lineParams>(
          `
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
          `
        )
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
  } catch (e) {
    console.error('[GET /inspections] failed', e);
    res.status(500).json({ error: String(e) });
  }
});

// ===== 出荷 → 検品データ生成 =====

inspections.post('/inspections/generate-from-shipments', (req, res) => {
  const body = (req.body ?? {}) as GenerateFromShipmentsPayload;

  if (
    !body.ownerId ||
    !Array.isArray(body.shipmentHeaderIds) ||
    body.shipmentHeaderIds.length === 0
  ) {
    return res
      .status(400)
      .json({ ok: false, error: 'ownerId / shipmentHeaderIds が必要です' });
  }

  const ownerType: OwnerType = body.ownerType ?? 'STORE';
  if (ownerType !== 'STORE') {
    return res
      .status(400)
      .json({ ok: false, error: "現在は ownerType='STORE' のみ対応しています" });
  }

  const ownerId = ID.store(body.ownerId);
  if (!ownerId) {
    return res.status(400).json({ ok: false, error: 'ownerId が不正です' });
  }

  const shipmentIds = Array.from(
    new Set(
      body.shipmentHeaderIds
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  );

  if (shipmentIds.length === 0) {
    return res
      .status(400)
      .json({ ok: false, error: 'shipmentHeaderIds が不正です' });
  }

  try {
    const placeholders = shipmentIds.map(() => '?').join(',');
    const shipments = db
      .prepare(
        `
        SELECT
          id,
          vendor_id      AS vendorId,
          destination_id AS destinationId,
          delivery_date  AS deliveryDate,
          status
        FROM shipments
        WHERE id IN (${placeholders})
        `
      )
      .all(...shipmentIds) as {
      id: number;
      vendorId: string;
      destinationId: string;
      deliveryDate: string;
      status: string;
    }[];

    if (shipments.length === 0) {
      const result: GenerateFromShipmentsResult = {
        ok: true,
        createdHeaders: 0,
        createdLines: 0,
        processedShipments: 0,
        skippedShipments: shipmentIds.length,
      };
      return res.json(result);
    }

    const confirmedShipments = shipments.filter(
      (s) => s.status === 'confirmed'
    );
    if (confirmedShipments.length === 0) {
      const result: GenerateFromShipmentsResult = {
        ok: true,
        createdHeaders: 0,
        createdLines: 0,
        processedShipments: 0,
        skippedShipments: shipmentIds.length,
      };
      return res.json(result);
    }

    const tx = db.transaction(() => {
      let createdHeaders = 0;
      let affectedLines = 0;

      const confirmedIds = confirmedShipments.map((s) => s.id);
      const inPlaceholders = confirmedIds.map(() => '?').join(',');

      const existing = db
        .prepare(
          `
          SELECT id, shipment_id AS shipmentId
          FROM inspections
          WHERE shipment_id IN (${inPlaceholders})
          `
        )
        .all(...confirmedIds) as { id: number; shipmentId: number }[];

      const shipmentIdToInspectionId = new Map<number, number>();
      for (const row of existing) {
        shipmentIdToInspectionId.set(row.shipmentId, row.id);
      }

      const insertInspection = db.prepare(
        `
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
        `
      );

      const selectShipmentLines = db.prepare(
        `
        SELECT
          item_id   AS itemId,
          ship_qty  AS shipQty,
          unit_price AS unitPrice,
          unit,
          spec,
          temp_zone AS tempZone,
          lot_no    AS lotNo,
          note
        FROM shipment_lines
        WHERE shipment_id = ?
        `
      );

      const upsertInspectionLine = db.prepare(
        `
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
          unit_price,
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
        `
      );

      for (const s of confirmedShipments) {
        let inspectionId = shipmentIdToInspectionId.get(s.id);

          if (!inspectionId) {
            const r = insertInspection.run({
              shipmentId: s.id,
              ownerId,
              deliveryDate: s.deliveryDate, // ← ここを追加
          });

          if (r.changes && r.changes > 0) {
            createdHeaders += 1;
          }

          const row = db
            .prepare(
              `
            SELECT id
            FROM inspections
            WHERE shipment_id = ?
            `
            )
            .get(s.id) as { id: number } | undefined;

          if (!row) {
            throw new Error(
              `failed to fetch inspection header for shipment ${s.id}`
            );
          }
          inspectionId = row.id;
          shipmentIdToInspectionId.set(s.id, inspectionId);
        }

        const lines = selectShipmentLines.all(s.id) as {
          itemId: string;
          shipQty: number;
          unit: string | null;
          spec: string | null;
          tempZone: string | null;
          lotNo: string | null;
          note: string | null;
          // 追加 ここから
          unitPrice: number;
          // 追加 ここまで
        }[];
 
        for (const ln of lines) {
          const shipQty = Number(ln.shipQty ?? 0);
          // const inspectedQty = shipQty;
          // const diffQty = 0;
          // 追加 ここから
          const unitPrice = Number(ln.unitPrice ?? 0);
          const inspectedQty = Number(ln.shipQty ?? 0); // 生成時は出荷数を初期値にする想定
          const amount = inspectedQty * unitPrice;
          // 追加 ここまで
          const r2 = upsertInspectionLine.run({
            inspectionId,
            itemId: ln.itemId,
            shipQty: ln.shipQty,
            inspectedQty,
            // diffQty: inspectedQty - Number(ln.shipQty ?? 0), // 生成時は 0 のはず
            diffQty: 0,
            unit: ln.unit ?? null,
            spec: ln.spec ?? null,
            tempZone: ln.tempZone ?? null,
            lotNo: ln.lotNo ?? null,
            note: ln.note ?? null,
            // 単価、金額を追加
            unitPrice,  
            amount,         
          });

          if (r2.changes && r2.changes > 0) {
            affectedLines += r2.changes;
          }
        }

        db.prepare(
          `
          UPDATE inspections
             SET updated_at = datetime('now','localtime')
           WHERE id = ?
          `
        ).run(inspectionId);
      }

      return { createdHeaders, affectedLines };
    });

    const { createdHeaders, affectedLines } = tx();

    const processedShipments = confirmedShipments.length;
    const skippedShipments = shipmentIds.length - processedShipments;

    const result: GenerateFromShipmentsResult = {
      ok: true,
      createdHeaders,
      createdLines: affectedLines,
      processedShipments,
      skippedShipments,
    };

    return res.json(result);
  } catch (e: any) {
    console.error('[/inspections/generate-from-shipments] error:', e);
    return res
      .status(500)
      .json({ ok: false, error: String(e?.message ?? e) });
  }
});

// ===== 検品ヘッダ＋明細1件取得 =====

inspections.get('/inspections/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'invalid id' });
    }

    const header = db
      .prepare(
        `
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
        `
      )
      .get(id) as
      | {
          id: number;
          shipmentId: number;
          ownerId: string;
          status: string;
          createdAt: string;
          updatedAt: string;
          vendorId: string;
          destinationId: string;
          destinationName: string | null;
          deliveryDate: string;
        }
      | undefined;

    if (!header) {
      return res.status(404).json({ ok: false, error: 'not found' });
    }

    const lines = db
      .prepare(
        `
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
        `
      )
      .all(id);

    res.json({ ok: true, header, lines });
  } catch (e: any) {
    console.error('[/inspections/:id] error:', e);
    res
      .status(500)
      .json({ ok: false, error: String(e?.message ?? e) });
  }
});

// ===== 検品明細の保存（数量・ロット・備考） =====

inspections.patch('/inspections/:id/lines', (req, res) => {
  try {
    const inspectionId = Number(req.params.id);
    if (!Number.isFinite(inspectionId)) {
      return res.status(400).json({ ok: false, error: 'invalid id' });
    }

    const body = req.body || {};
    const rawLines: any[] = Array.isArray(body.lines) ? body.lines : [];

    const tx = db.transaction((lines: any[]) => {
      const upd = db.prepare(
        `
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
        `
      );

      for (const row of lines) {
        const lineId = Number(row.id ?? row.lineId ?? 0);
        if (!Number.isFinite(lineId)) continue;

        const inspectedQty = Number(row.inspectedQty ?? 0);
        const lotNo =
          row.lotNo != null && row.lotNo !== ''
            ? String(row.lotNo)
            : null;
        const note =
          row.note != null && row.note !== ''
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

      db.prepare(
        `
        UPDATE inspections
        SET updated_at = datetime('now','localtime')
        WHERE id = ?
        `
      ).run(inspectionId);
    });

    tx(rawLines);

    res.json({ ok: true });
  } catch (e: any) {
    console.error('[/inspections/:id/lines] error:', e);
    res
      .status(500)
      .json({ ok: false, error: String(e?.message ?? e) });
  }
});

// ===== 検品 確定 =====
// body: { ids: number[] }
inspections.post('/inspections/confirm', (req, res) => {
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

    const tx = db.transaction((targetIds: number[]) => {
      if (targetIds.length === 0) {
        return { updated: 0, movements: 0 };
      }

    const placeholders = targetIds.map(() => '?').join(',');


      type MovementSourceRow = {
        inspectionId: number;
        storeId: string;
        deliveryDate: string;
        itemId: string;
        inspectedQty: number;
        stockConv: number;   // ★ 追加：在庫単位への変換係数
        unitPrice: number;   // ★ 追加：発注単位あたり単価（shipment_lines.unit_price）
      };

      const srcRows = db
              .prepare(
         `
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
          `
        )
        .all(...targetIds) as MovementSourceRow[];

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
        `
      );

      // 0円はOK。NULL/空/非数のみNG
      const missing = srcRows.filter(r => {
        const v: any = (r as any).unitPrice;
        if (v === null || v === undefined || v === "") return true;
        return !Number.isFinite(Number(v));
      });
      if (missing.length > 0) {
        // どの検品ID・品目が原因か返す（フロントで表示できる）
        const items = Array.from(new Set(missing.map(m => m.itemId))).sort();
        const inspections = Array.from(new Set(missing.map(m => m.inspectionId))).sort((a,b)=>a-b);
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
        const conv      = Number(r.stockConv ?? 1);
        const stockQty  = inspected * conv;

        if (stockQty === 0) continue;  // 念のため 0 行はスキップ

        const unitPrice = Number(r.unitPrice ?? 0);   // inspection_lines.unit_price
        const unitCost  = unitPrice / conv;           // 在庫単位単価
        const amount    = stockQty * unitCost;        // = inspected * unitPrice

        insMove.run({
          storeId: r.storeId,
          itemId: r.itemId,
          movementDate: r.deliveryDate,
          qty: stockQty,               // 在庫単位で記録
          refId: r.inspectionId,
          unitCost,
          amount,
        });
        movements++;
      }

      // 3. ヘッダステータスを open → completed に更新
      const upd = db
        .prepare(
          `
          UPDATE inspections
             SET status     = 'completed',
                 updated_at = datetime('now','localtime')
           WHERE id IN (${placeholders})
             AND status = 'open'
          `
        )
        .run(...targetIds);

      return { updated: upd.changes ?? 0, movements };
    });

    const result = tx(ids);
    res.json(result);
  } catch (e: any) {
    console.error('[/inspections/confirm] error:', e);
    res
      .status(500)
      .json({ ok: false, error: String(e?.message ?? e) });
  }
});



// ===== 検品 監査（audited へ遷移） =====
// body: { ids: number[] }
inspections.post("/inspections/audit", (req, res) => {
  try {
    const ids: number[] = Array.isArray(req.body?.ids)
      ? (req.body.ids as any[]).map((x) => Number(x))
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

    const r = db.prepare(sql).run(...validIds);
    res.json({ updated: r.changes ?? 0 });
  } catch (e: any) {
    console.error("[/inspections/audit] error:", e);
    res
      .status(500)
      .json({ ok: false, error: String(e?.message ?? e) });
  }
});

