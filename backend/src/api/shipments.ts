import { Router } from 'express';
import { db } from '../db';
import { ID } from '../lib/id';

export const shipments = Router();

// ===== 型定義（バックエンド内だけで使用） =====
type ShipmentHeaderRow = {
  id: number;
  vendor_id: string;
  destination_id: string;
  destination_name: string | null;
  delivery_date: string;
  status: 'open' | 'confirmed' | 'canceled';
  created_at: string;
  updated_at: string;
};

type ShipmentLineRow = {
  id: number;
  shipment_id: number;
  item_id: string;
  ordered_qty: number;
  ship_qty: number;
  unit_price: number;
  amount: number;
  unit: string | null;
  spec: string | null;
  temp_zone: string | null;
  lot_no: string | null;
  note: string | null;
};

// 出荷自動生成で使う中間行
type ResolvedRow = {
  orderId: string;
  storeId: string;
  vendorId: string;
  orderDate: string;     // 'YYYY-MM-DD'
  itemId: string;
  qty: number;
  unitPrice: number | null; // 価格が見つからない場合あり
  deliveryDate: string;  // 'YYYY-MM-DD'
    // 締切判定用（SQL側で埋める）
  orderable?: number | null;
  cutoffHHmm?: string | null;
};

// ===== 共通ヘルパ =====
function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ===== 一覧取得 (/shipments) =====
// VendorShipments の検索で利用（snake_case で返す）
shipments.get('/shipments', (req, res) => {
  // 日付パラメータは 'YYYY-MM-DD' に丸めておく
  const df = String(req.query.from || '').slice(0, 10);
  const dt = String(req.query.to || '').slice(0, 10);

  const vendorId = req.query.vendorId ? ID.vendor(String(req.query.vendorId)) : '';
  const destinationId = req.query.destinationId ? ID.store(String(req.query.destinationId)) : '';

  // 伝票番号（ヘッダID）検索
  // - 数字だけを抜き出して Number に変換
  // - "123" / "SHP-000123" どちらも 123 として扱う
  const headerIdRaw = String(req.query.headerId || '').trim();
  let headerId: number | null = null;
  if (headerIdRaw) {
    const digits = headerIdRaw.replace(/\D/g, '');
    if (digits) {
      const n = Number(digits);
      if (Number.isFinite(n)) headerId = n;
    }
  }

  const where: string[] = [];
  const params: any = {};

  if (df) {
    where.push('s.delivery_date >= @df');
    params.df = df;
  }
  if (dt) {
    where.push('s.delivery_date <= @dt');
    params.dt = dt;
  }
  if (vendorId) {
    where.push('s.vendor_id = @vid');
    params.vid = vendorId;
  }
  if (destinationId) {
    where.push('s.destination_id = @did');
    params.did = destinationId;
  }
  if (headerId != null) {
    // 伝票番号での絞り込み（完全一致）
    where.push('s.id = @hid');
    params.hid = headerId;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db.prepare(
    `
    SELECT
      s.id,
      s.vendor_id,
      v.name AS vendor_name,
      s.destination_id,
      s.destination_name,
      s.delivery_date,
      s.status,
      s.created_at,
      s.updated_at
    FROM shipments s
    LEFT JOIN vendors v ON v.id = s.vendor_id
    ${whereSql}
    ORDER BY s.delivery_date, s.vendor_id, s.destination_id, s.id
    `
  ).all(params) as (ShipmentHeaderRow & { vendor_name?: string | null })[];

  const headers = rows.map(r => ({
    id: r.id,
    delivery_date: r.delivery_date,
    status: r.status,
    vendor_id: r.vendor_id,
    vendor_name: r.vendor_name ?? null,
    destination_id: r.destination_id,
    destination_name: r.destination_name ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  res.json(headers);
});

// ===== 伝票＋明細取得 (/shipments/:id) =====
shipments.get('/shipments/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const header = db.prepare(
    `
    SELECT
      s.id,
      s.vendor_id,
      v.name AS vendor_name,
      s.destination_id,
      s.destination_name,
      s.delivery_date,
      s.status,
      s.created_at,
      s.updated_at
    FROM shipments s
    LEFT JOIN vendors v ON v.id = s.vendor_id
    WHERE s.id = ?
    `
  ).get(id) as (ShipmentHeaderRow & { vendor_name?: string | null }) | undefined;

  if (!header) return res.status(404).json({ error: 'not found' });

  const lines = db.prepare(
    `
    SELECT
      l.id,
      l.shipment_id,
      l.item_id,
      i.name AS item_name,
      l.ordered_qty,
      l.ship_qty,
      l.unit_price,
      l.amount,
      l.unit,
      l.spec,
      l.temp_zone,
      l.lot_no,
      l.note
    FROM shipment_lines l
    LEFT JOIN items i ON i.id = l.item_id
    WHERE l.shipment_id = ?
    ORDER BY l.id
    `
  ).all(id) as (ShipmentLineRow & { item_name?: string | null })[];

  res.json({
    header: {
      id: header.id,
      deliveryDate: header.delivery_date,
      status: header.status,
      vendorId: header.vendor_id,
      vendorName: header.vendor_name ?? undefined,
      destinationId: header.destination_id,
      destinationName: header.destination_name ?? undefined,
      createdAt: header.created_at,
      updatedAt: header.updated_at,
    },
    lines: lines.map(l => ({
      id: l.id,
      shipment_id: l.shipment_id,
      item_id: l.item_id,
      item_name: l.item_name ?? null,
      ordered_qty: l.ordered_qty,
      ship_qty: l.ship_qty,
      unit_price: l.unit_price,
      amount: l.amount,
      unit: l.unit,
      spec: l.spec,
      temp_zone: l.temp_zone,
      lot_no: l.lot_no,
      note: l.note,
    })),
  });
});

// ===== 明細のみ (/shipments/:id/lines) =====
shipments.get('/shipments/:id/lines', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const lines = db.prepare(
    `
    SELECT
      l.id,
      l.shipment_id,
      l.item_id,
      i.name AS item_name,
      l.ordered_qty,
      l.ship_qty,
      l.unit_price,
      l.amount,
      l.unit,
      l.spec,
      l.temp_zone,
      l.lot_no,
      l.note
    FROM shipment_lines l
    LEFT JOIN items i ON i.id = l.item_id
    WHERE l.shipment_id = ?
    ORDER BY l.id
    `
  ).all(id) as (ShipmentLineRow & { item_name?: string | null })[];

  res.json(
    lines.map(l => ({
      id: l.id,
      shipment_id: l.shipment_id,
      item_id: l.item_id,
      item_name: l.item_name ?? null,
      ordered_qty: l.ordered_qty,
      ship_qty: l.ship_qty,
      unit_price: l.unit_price,
      amount: l.amount,
      unit: l.unit,
      spec: l.spec,
      temp_zone: l.temp_zone,
      lot_no: l.lot_no,
      note: l.note,
    })),
  );
});

// ===== 新規作成 (/shipments/create) =====
shipments.post('/shipments/create', (req, res) => {
  const body = req.body || {};
  const deliveryDate = String(body.deliveryDate || '').slice(0, 10);
  const vendorId = ID.vendor(String(body.vendorId || ''));
  const destinationId = ID.store(String(body.destinationId || ''));
  const destinationName: string | null =
    body.destinationName != null && body.destinationName !== ''
      ? String(body.destinationName)
      : null;

  if (!deliveryDate || !vendorId || !destinationId) {
    return res.status(400).json({ ok: false, error: 'deliveryDate, vendorId, destinationId are required' });
  }

  const rawLines: any[] = Array.isArray(body.lines) ? body.lines : [];

  const tx = db.transaction(() => {
    const hr = db.prepare(
      `
      INSERT INTO shipments (vendor_id, destination_id, destination_name, delivery_date, status)
      VALUES (@vendorId, @destinationId, @destinationName, @deliveryDate, 'open')
      `
    ).run({
      vendorId,
      destinationId,
      destinationName,
      deliveryDate,
    });

    const headerId = Number(hr.lastInsertRowid);

    if (rawLines.length) {
      const insLine = db.prepare(
        `
        INSERT INTO shipment_lines
          (shipment_id, item_id, ordered_qty, ship_qty, unit_price, amount, unit, spec, temp_zone, lot_no, note)
        VALUES
          (@shipmentId, @itemId, @orderedQty, @shipQty, @unitPrice, @amount, @unit, @spec, @tempZone, @lotNo, @note)
        `
      );

      for (const r of rawLines) {
        const itemId = ID.item(String(r.itemId || r.item_id || ''));
        if (!itemId) continue;

        const shipQty = Number(r.shipQty ?? r.ship_qty ?? 0);
        const orderedQty = Number(r.orderedQty ?? r.ordered_qty ?? shipQty);
        const unitPrice = Number(r.unitPrice ?? r.unit_price ?? 0);
        const amount =
          r.amount != null
            ? Number(r.amount)
            : shipQty * unitPrice;

        insLine.run({
          shipmentId: headerId,
          itemId,
          orderedQty,
          shipQty,
          unitPrice,
          amount,
          unit: r.unit ?? null,
          spec: r.spec ?? null,
          tempZone: r.tempZone ?? r.temp_zone ?? null,
          lotNo: r.lotNo ?? r.lot_no ?? null,
          note: r.note ?? null,
        });
      }
    }

    return headerId;
  });

  const newId = tx() as number;

  // レスポンスは VendorOrderHeader 形式（camelCase）
  const headerRow = db.prepare(
    `
    SELECT
      s.id,
      s.vendor_id,
      v.name AS vendor_name,
      s.destination_id,
      s.destination_name,
      s.delivery_date,
      s.status,
      s.created_at,
      s.updated_at
    FROM shipments s
    LEFT JOIN vendors v ON v.id = s.vendor_id
    WHERE s.id = ?
    `
  ).get(newId) as (ShipmentHeaderRow & { vendor_name?: string | null });

  const header = {
    id: String(headerRow.id),
    deliveryDate: headerRow.delivery_date,
    status: headerRow.status,
    vendorId: headerRow.vendor_id,
    vendorName: headerRow.vendor_name ?? undefined,
    destinationId: headerRow.destination_id,
    destinationName: headerRow.destination_name ?? undefined,
  };

  res.status(201).json({ ok: true, header });
});

// ===== ヘッダ更新 (/shipments/:id PATCH) =====
shipments.patch('/shipments/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const body = req.body || {};

  const existing = db.prepare(
    `
    SELECT
      id, vendor_id, destination_id, destination_name, delivery_date, status
    FROM shipments
    WHERE id = ?
    `
  ).get(id) as {
    id: number;
    vendor_id: string;
    destination_id: string;
    destination_name: string | null;
    delivery_date: string;
    status: string;
  } | undefined;

  if (!existing) return res.status(404).json({ error: 'not found' });

  const deliveryDate =
    body.deliveryDate != null ? String(body.deliveryDate).slice(0, 10) : existing.delivery_date;
  const vendorId =
    body.vendorId != null && body.vendorId !== ''
      ? ID.vendor(String(body.vendorId))
      : existing.vendor_id;
  const destinationId =
    body.destinationId != null && body.destinationId !== ''
      ? ID.store(String(body.destinationId))
      : existing.destination_id;
  const destinationName =
    body.destinationName !== undefined
      ? (body.destinationName != null && body.destinationName !== ''
          ? String(body.destinationName)
          : null)
      : existing.destination_name;
  const status =
    body.status != null ? String(body.status) : existing.status;

  db.prepare(
    `
    UPDATE shipments
       SET delivery_date    = @deliveryDate,
           vendor_id        = @vendorId,
           destination_id   = @destinationId,
           destination_name = @destinationName,
           status           = @status,
           updated_at       = datetime('now')
     WHERE id = @id
    `
  ).run({
    id,
    deliveryDate,
    vendorId,
    destinationId,
    destinationName,
    status,
  });

  res.json({ ok: true });
});

// ===== 明細一括置換 (/shipments/:id/lines/replace, /lines/bulk) =====
function replaceLinesInternal(shipmentId: number, rows: any[]) {
  const tx = db.transaction((lines: any[]) => {
    db.prepare(`DELETE FROM shipment_lines WHERE shipment_id = ?`).run(shipmentId);

    if (!lines.length) return;

    const ins = db.prepare(
      `
      INSERT INTO shipment_lines
        (shipment_id, item_id, ordered_qty, ship_qty, unit_price, amount, unit, spec, temp_zone, lot_no, note)
      VALUES
        (@shipmentId, @itemId, @orderedQty, @shipQty, @unitPrice, @amount, @unit, @spec, @tempZone, @lotNo, @note)
      `
    );

    for (const r of lines) {
      const itemId = ID.item(String(r.itemId ?? r.item_id ?? ''));
      if (!itemId) continue;

      const shipQty = Number(r.shipQty ?? r.ship_qty ?? 0);
      const orderedQty = Number(r.orderedQty ?? r.ordered_qty ?? shipQty);
      const unitPrice = Number(r.unitPrice ?? r.unit_price ?? 0);
      const amount =
        r.amount != null
          ? Number(r.amount)
          : shipQty * unitPrice;

      ins.run({
        shipmentId,
        itemId,
        orderedQty,
        shipQty,
        unitPrice,
        amount,
        unit: r.unit ?? null,
        spec: r.spec ?? null,
        tempZone: r.tempZone ?? r.temp_zone ?? null,
        lotNo: r.lotNo ?? r.lot_no ?? null,
        note: r.note ?? null,
      });
    }
  });

  tx(rows || []);
}

shipments.post('/shipments/:id/lines/replace', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const lines: any[] = Array.isArray(req.body?.lines) ? req.body.lines : [];
  replaceLinesInternal(id, lines);

  res.json({ ok: true });
});

// saveLines 用のエイリアス
shipments.post('/shipments/:id/lines/bulk', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const lines: any[] = Array.isArray(req.body) ? req.body : [];
  replaceLinesInternal(id, lines);

  res.json({ ok: true });
});

// 旧 UI 互換: /shipments/lines/replace, /vendor/shipments/lines/replace
shipments.post(['/shipments/lines/replace', '/vendor/shipments/lines/replace'], (req, res) => {
  const headerId = Number(req.body?.headerId);
  if (!Number.isFinite(headerId)) return res.status(400).json({ error: 'invalid headerId' });

  const lines: any[] = Array.isArray(req.body?.lines) ? req.body.lines : [];
  replaceLinesInternal(headerId, lines);

  res.json({ ok: true });
});

// ===== 単行削除 (/shipments/:id/lines/:itemId) =====
shipments.delete('/shipments/:id/lines/:itemId', (req, res) => {
  const shipmentId = Number(req.params.id);
  if (!Number.isFinite(shipmentId)) return res.status(400).json({ error: 'invalid id' });

  const itemId = ID.item(String(req.params.itemId || ''));
  if (!itemId) return res.status(400).json({ error: 'invalid itemId' });

  db.prepare(
    `DELETE FROM shipment_lines WHERE shipment_id = @shipmentId AND item_id = @itemId`
  ).run({ shipmentId, itemId });

  res.json({ ok: true });
});

// 旧 UI 互換: クエリ版
shipments.delete(['/shipments/line', '/vendor/shipments/line'], (req, res) => {
  const headerId = Number(req.query.headerId);
  const itemId = ID.item(String(req.query.itemId || ''));
  if (!Number.isFinite(headerId) || !itemId) {
    return res.status(400).json({ error: 'invalid headerId or itemId' });
  }

  db.prepare(
    `DELETE FROM shipment_lines WHERE shipment_id = @shipmentId AND item_id = @itemId`
  ).run({ shipmentId: headerId, itemId });

  res.json({ ok: true });
});

// ===== 確定/取消 =====
shipments.post('/shipments/confirm', (req, res) => {
  const ids: number[] = Array.isArray(req.body?.ids)
    ? (req.body.ids as any[]).map((x) => Number(x))
    : [];
  const validIds = ids.filter((x) => Number.isFinite(x));
  if (!validIds.length) return res.json({ updated: 0 });

  const q = `
    UPDATE shipments
       SET status = 'confirmed',
           updated_at = datetime('now')
     WHERE id IN (${validIds.map(() => '?').join(',')})
       AND status = 'open'
  `;
  const r = db.prepare(q).run(...validIds);
  res.json({ updated: r.changes });
});

shipments.post('/shipments/unconfirm', (req, res) => {
  const ids: number[] = Array.isArray(req.body?.ids)
    ? (req.body.ids as any[]).map((x) => Number(x))
    : [];
  const validIds = ids.filter((x) => Number.isFinite(x));
  if (!validIds.length) return res.json({ updated: 0 });

  const q = `
    UPDATE shipments
       SET status = 'open',
           updated_at = datetime('now')
     WHERE id IN (${validIds.map(() => '?').join(',')})
       AND status = 'confirmed'
  `;
  const r = db.prepare(q).run(...validIds);
  res.json({ updated: r.changes });
});

// ===== 出荷自動生成 共通ロジック =====
// function generateShipmentsInternal(
//   params: {
//     asOf?: string;
//     from?: string;
//     to?: string;
//     vendorId?: string;
//     destinationId?: string;
//   },
//   dryRun: boolean
// ) {
//   const df = String(params.from || '');
//   const dt = String(params.to || '');
//   const vid = params.vendorId ? ID.vendor(String(params.vendorId)) : undefined;
//   const did = params.destinationId ? ID.store(String(params.destinationId)) : undefined;

//   // 締切判定用：空なら「締切判定なし」として全件対象
//   const asOf = params.asOf ? String(params.asOf) : '';

//   // orders / order_lines / vendor_weekly_rules / item_prices から集約
//   const src = db.prepare(
//     `
//     WITH base AS (
//       SELECT
//         o.id         AS orderId,
//         o.store_id   AS storeId,
//         o.vendor_id  AS headerVendorId,
//         o.order_date AS orderDate
//       FROM orders o
//       WHERE (@df = '' OR o.order_date >= @df)
//         AND (@dt = '' OR o.order_date <= @dt)
//       -- vendorId フィルタは後段（resolved）で line.vendorId に対して行う
//     ),
//     lines AS (
//       SELECT
//         b.orderId,
//         b.storeId,
//         /* ヘッダに vendor_id があればそちらを優先、なければ明細側 */
//         COALESCE(ol.vendor_id, b.headerVendorId) AS vendorId,
//         b.orderDate,
//         ol.item_id AS itemId,
//         SUM(ol.qty) AS qty,
//         (
//           SELECT ip.unit_price
//           FROM item_prices ip
//           WHERE ip.vendor_id = COALESCE(ol.vendor_id, b.headerVendorId)
//             AND ip.item_id   = ol.item_id
//             AND ip.valid_from <= b.orderDate
//             AND (ip.valid_to IS NULL OR ip.valid_to >= b.orderDate)
//           ORDER BY ip.valid_from DESC
//           LIMIT 1
//         ) AS unitPrice
//       FROM base b
//       JOIN order_lines ol ON ol.order_id = b.orderId
//       GROUP BY
//         b.orderId,
//         b.storeId,
//         vendorId,
//         b.orderDate,
//         ol.item_id
//     ),
//     vw AS (
//       SELECT
//         l.*,
//         CASE strftime('%w', l.orderDate)
//           WHEN '0' THEN (SELECT lead_time_days_sun FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
//           WHEN '1' THEN (SELECT lead_time_days_mon FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
//           WHEN '2' THEN (SELECT lead_time_days_tue FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
//           WHEN '3' THEN (SELECT lead_time_days_wed FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
//           WHEN '4' THEN (SELECT lead_time_days_thu FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
//           WHEN '5' THEN (SELECT lead_time_days_fri FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
//           WHEN '6' THEN (SELECT lead_time_days_sat FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
//         END AS lt
//       FROM lines l
//     ),
//     resolved AS (
//       SELECT
//         orderId,
//         storeId,
//         vendorId,
//         orderDate,
//         itemId,
//         qty,
//         COALESCE(unitPrice, 0) AS unitPrice,
//         date(orderDate, printf('+%d day', COALESCE(lt, 1))) AS deliveryDate
//       FROM vw
//     )
//     SELECT *
//     FROM resolved
//     WHERE (@vid IS NULL OR vendorId = @vid)
//       AND (COALESCE(@did,'') = '' OR storeId = @did)
//     `
//   ).all({
//     df,
//     dt,
//     vid: vid ?? null,
//     did: did ?? '',
//   }) as ResolvedRow[];

// 
function generateShipmentsInternal(
  params: {
    asOf?: string;
    from?: string;
    to?: string;
    vendorId?: string;
    destinationId?: string;
  },
  dryRun: boolean
) {
  const df = String(params.from || '');   // ← これを「納品日 from」とみなす
  const dt = String(params.to || '');     // ← 「納品日 to」
  const vid = params.vendorId ? ID.vendor(String(params.vendorId)) : undefined;
  const did = params.destinationId ? ID.store(String(params.destinationId)) : undefined;
  const asOf = params.asOf ? String(params.asOf) : '';

  const src = db.prepare(
    `
    WITH base AS (
      SELECT
        o.id         AS orderId,
        o.store_id   AS storeId,
        o.vendor_id  AS headerVendorId,
        o.order_date AS orderDate
      FROM orders o
      -- ★ ここではもう発注日で絞り込まない
    ),
    lines AS (
      SELECT
        b.orderId,
        b.storeId,
        COALESCE(ol.vendor_id, b.headerVendorId) AS vendorId,
        b.orderDate,
        ol.item_id AS itemId,
        SUM(ol.qty) AS qty,
        (
          SELECT ip.unit_price
          FROM item_prices ip
          WHERE ip.vendor_id = COALESCE(ol.vendor_id, b.headerVendorId)
            AND ip.item_id   = ol.item_id
            AND ip.valid_from <= b.orderDate
            AND (ip.valid_to IS NULL OR ip.valid_to >= b.orderDate)
          ORDER BY ip.valid_from DESC
          LIMIT 1
        ) AS unitPrice
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
        CASE strftime('%w', l.orderDate)
          WHEN '0' THEN (SELECT lead_time_days_sun FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
          WHEN '1' THEN (SELECT lead_time_days_mon FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
          WHEN '2' THEN (SELECT lead_time_days_tue FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
          WHEN '3' THEN (SELECT lead_time_days_wed FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
          WHEN '4' THEN (SELECT lead_time_days_thu FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
          WHEN '5' THEN (SELECT lead_time_days_fri FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
          WHEN '6' THEN (SELECT lead_time_days_sat FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
        END AS lt,
        CASE strftime('%w', l.orderDate)
          WHEN '0' THEN (SELECT orderable_sun   FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
          WHEN '1' THEN (SELECT orderable_mon   FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
          WHEN '2' THEN (SELECT orderable_tue   FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
          WHEN '3' THEN (SELECT orderable_wed   FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
          WHEN '4' THEN (SELECT orderable_thu   FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
          WHEN '5' THEN (SELECT orderable_fri   FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
          WHEN '6' THEN (SELECT orderable_sat   FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
        END AS orderable_raw,
        CASE strftime('%w', l.orderDate)
          WHEN '0' THEN (SELECT cutoff_hhmm_sun FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
          WHEN '1' THEN (SELECT cutoff_hhmm_mon FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
          WHEN '2' THEN (SELECT cutoff_hhmm_tue FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
          WHEN '3' THEN (SELECT cutoff_hhmm_wed FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
          WHEN '4' THEN (SELECT cutoff_hhmm_thu FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
          WHEN '5' THEN (SELECT cutoff_hhmm_fri FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
          WHEN '6' THEN (SELECT cutoff_hhmm_sat FROM vendor_weekly_rules v WHERE v.vendor_id = l.vendorId)
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
        COALESCE(unitPrice, 0) AS unitPrice,
        date(orderDate, printf('+%d day', COALESCE(lt, 1))) AS deliveryDate,
        COALESCE(orderable_raw, 1) AS orderable,
        COALESCE(cutoffHHmm_raw, '00:00') AS cutoffHHmm
      FROM vw
    ),
    filtered AS (
      SELECT *
      FROM resolved
      WHERE
        -- ベンダー／店舗フィルタ
        (@vid IS NULL OR vendorId = @vid)
        AND (COALESCE(@did,'') = '' OR storeId = @did)
        -- 納品日での絞り込み（★ここを追加★）
        AND (@df = '' OR deliveryDate >= @df)
        AND (@dt = '' OR deliveryDate <= @dt)
        -- 発注不可日は除外
        AND orderable = 1
        -- 締切超過判定
        AND (
          @asOf = ''
          OR datetime(@asOf) >= datetime(orderDate || ' ' || cutoffHHmm)
        )
    )
    SELECT *
    FROM filtered
    `
  ).all({
    df,
    dt,
    vid: vid ?? null,
    did: did ?? '',
    asOf,
  }) as ResolvedRow[];

  // ひとつも対象が無いなら、preview も 0/0 で返却
  if (!src.length) {
    return {
      ok: true,
      countHeaders: 0,
      countLines: 0,
      headersAffected: 0,
      linesAffected: 0,
    };
  }
  // 「どの組み合わせでヘッダが立つか」を事前に数えておく
  const headerKeySet = new Set<string>();
  for (const r of src) {
    const vendorId = ID.vendor(r.vendorId);
    const destinationId = ID.store(r.storeId);
    const deliveryDate = r.deliveryDate;
    if (!vendorId || !destinationId || !deliveryDate) continue;
    headerKeySet.add(`${vendorId}|${destinationId}|${deliveryDate}`);
  }

  // プレビューのみ
  if (dryRun) {
    const headerKeys = new Set(
      src.map(r => `${r.vendorId}|${r.storeId}|${r.deliveryDate}`)
    );
    return {
      ok: true,
      countHeaders: headerKeys.size,
      countLines: src.length,
      headersAffected: headerKeys.size,
      linesAffected: src.length,
    };
  }
  
  // 本処理：shipments / shipment_lines へ UPSERT
  const getStoreName = db.prepare(
    `
    SELECT name
      FROM stores
     WHERE id = ?
    `
  );

  const insHeader = db.prepare(
    `
    INSERT INTO shipments (vendor_id, destination_id, destination_name, delivery_date, status)
    VALUES (@vendorId, @destinationId, @destinationName, @deliveryDate, 'open')
    ON CONFLICT(vendor_id, destination_id, delivery_date)
    DO UPDATE SET
      destination_name = COALESCE(excluded.destination_name, destination_name),
      updated_at       = datetime('now')
    `
  );
  const getHeader = db.prepare(
    `
    SELECT id
      FROM shipments
     WHERE vendor_id = @vendorId
       AND destination_id = @destinationId
       AND delivery_date = @deliveryDate
    `
  );
  const insLine = db.prepare(
    `
    INSERT INTO shipment_lines
      (shipment_id, item_id, ordered_qty, ship_qty, unit_price, amount)
    VALUES
      (@headerId, @itemId, @qty, @qty, @unitPrice, @amount)
    ON CONFLICT(shipment_id, item_id) DO UPDATE SET
      ordered_qty = excluded.ordered_qty,
      ship_qty    = excluded.ship_qty,
      unit_price  = excluded.unit_price,
      amount      = excluded.amount
    `
  );

  let createdHeaders = 0;
  let upsertedLines = 0;

  const tx = db.transaction(() => {
    const headerKeyToId = new Map<string, number>();

    for (const r of src) {
      const key = `${r.vendorId}|${r.storeId}|${r.deliveryDate}`;
      if (!headerKeyToId.has(key)) {
        const before = getHeader.get({
          vendorId: r.vendorId,
          destinationId: r.storeId,
          deliveryDate: r.deliveryDate,
        }) as { id?: number } | undefined;

        if (!before?.id) {
          const store = getStoreName.get(r.storeId) as { name?: string } | undefined;
          const destinationName = store?.name ?? null;

          insHeader.run({
            vendorId: r.vendorId,
            destinationId: r.storeId,
            destinationName,
            deliveryDate: r.deliveryDate,
          });
          createdHeaders++;
        }

        const h = getHeader.get({
          vendorId: r.vendorId,
          destinationId: r.storeId,
          deliveryDate: r.deliveryDate,
        }) as { id: number };

        headerKeyToId.set(key, h.id);
      }

      const headerId = headerKeyToId.get(key)!;
      const unitPrice = Number(r.unitPrice ?? 0);
      const qty = Number(r.qty ?? 0);
      const amount = unitPrice * qty;

      const rr = insLine.run({
        headerId,
        itemId: r.itemId,
        qty,
        unitPrice,
        amount,
      });
      upsertedLines += rr.changes;
    }
  });

  tx();

  return {
    ok: true,
    headersAffected: createdHeaders,
    linesAffected: upsertedLines,
    countHeaders: createdHeaders,
    countLines: upsertedLines,
    // 旧フロント互換用
    createdHeaders,
    upsertedLines,
  };
}

// ===== 出荷生成（プレビュー） =====
shipments.post('/shipments/generate/preview', (req, res) => {
  try {
    const result = generateShipmentsInternal(req.body ?? {}, true);
    res.json(result);
  } catch (e: any) {
    console.error('[shipments/generate/preview] failed', e);
    // res.status(500).json({ ok: false, error: 'internal_error' });
    res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
});

// ===== 出荷生成（本処理） =====
shipments.post('/shipments/generate', (req, res) => {
  try {
    const result = generateShipmentsInternal(req.body ?? {}, false);
    res.json(result);
  } catch (e: any) {
    console.error('[shipments/generate] failed', e);
    // res.status(500).json({ ok: false, error: 'internal_error' });
    res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
});
