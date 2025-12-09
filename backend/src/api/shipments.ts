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
  order_date: string;  // ★ 追加（COALESCE 後の値）
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
    // order_date が入っていない古いレコードは delivery_date で代用
    where.push('COALESCE(s.order_date, s.delivery_date) >= @df');
    params.df = df;
  }
  if (dt) {
    where.push('COALESCE(s.order_date, s.delivery_date) <= @dt');
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
      s.order_date,
      s.delivery_date,
      COALESCE(s.order_date, s.delivery_date) AS order_date,  -- ★ 追加
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
    order_date: r.order_date ?? null,   // ★ 追加
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
  const orderDate = body.orderDate || body.deliveryDate;
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
      `
      
    ).run({
      vendorId,
      destinationId,
      destinationName,
      deliveryDate,
      orderDate,
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
           updated_at       = datetime('now','localtime')
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
           updated_at = datetime('now','localtime')
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
           updated_at = datetime('now','localtime')
     WHERE id IN (${validIds.map(() => '?').join(',')})
       AND status = 'confirmed'
  `;
  const r = db.prepare(q).run(...validIds);
  res.json({ updated: r.changes });
});

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
  const df = String(params.from || '');   // ← これを「発注日 from」とみなす
  const dt = String(params.to || '');     // ← 「発注日 to」
  const vid = params.vendorId ? ID.vendor(String(params.vendorId)) : undefined;
  const did = params.destinationId ? ID.store(String(params.destinationId)) : undefined;
  // const asOf = params.asOf ? String(params.asOf) : '';
  // asOf（基準日時）。指定が無ければ空文字のまま → cutoff 判定をスキップ
  const asOfRaw = params.asOf ? String(params.asOf) : '';
  const asOf =
    asOfRaw.length >= 16
      ? asOfRaw.replace('T', ' ').slice(0, 16) // 'YYYY-MM-DDTHH:MM:SS' → 'YYYY-MM-DD HH:MM'
      : asOfRaw;

  const src = db.prepare(
    `
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

        -- リードタイム（日数）: 店舗×ベンダー上書き → ベンダー週間ルール
        CASE strftime('%w', l.orderDate)
          WHEN '0' THEN COALESCE(
            (SELECT lead_time_days_sun_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT lead_time_days_sun FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
          WHEN '1' THEN COALESCE(
            (SELECT lead_time_days_mon_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT lead_time_days_mon FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
          WHEN '2' THEN COALESCE(
            (SELECT lead_time_days_tue_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT lead_time_days_tue FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
          WHEN '3' THEN COALESCE(
            (SELECT lead_time_days_wed_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT lead_time_days_wed FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
          WHEN '4' THEN COALESCE(
            (SELECT lead_time_days_thu_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT lead_time_days_thu FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
          WHEN '5' THEN COALESCE(
            (SELECT lead_time_days_fri_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT lead_time_days_fri FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
          WHEN '6' THEN COALESCE(
            (SELECT lead_time_days_sat_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT lead_time_days_sat FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
        END AS lt,

        -- 発注可否（店舗×ベンダー上書き → ベンダー週間ルール）
        CASE strftime('%w', l.orderDate)
          WHEN '0' THEN COALESCE(
            (SELECT orderable_sun_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT orderable_sun FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
          WHEN '1' THEN COALESCE(
            (SELECT orderable_mon_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT orderable_mon FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
          WHEN '2' THEN COALESCE(
            (SELECT orderable_tue_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT orderable_tue FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
          WHEN '3' THEN COALESCE(
            (SELECT orderable_wed_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT orderable_wed FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
          WHEN '4' THEN COALESCE(
            (SELECT orderable_thu_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT orderable_thu FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
          WHEN '5' THEN COALESCE(
            (SELECT orderable_fri_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT orderable_fri FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
          WHEN '6' THEN COALESCE(
            (SELECT orderable_sat_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT orderable_sat FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
        END AS orderable_raw,

        -- 締切時刻（HH:MM）
        CASE strftime('%w', l.orderDate)
          WHEN '0' THEN COALESCE(
            (SELECT cutoff_hhmm_sun_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT cutoff_hhmm_sun FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
          WHEN '1' THEN COALESCE(
            (SELECT cutoff_hhmm_mon_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT cutoff_hhmm_mon FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
          WHEN '2' THEN COALESCE(
            (SELECT cutoff_hhmm_tue_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT cutoff_hhmm_tue FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
          WHEN '3' THEN COALESCE(
            (SELECT cutoff_hhmm_wed_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT cutoff_hhmm_wed FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
          WHEN '4' THEN COALESCE(
            (SELECT cutoff_hhmm_thu_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT cutoff_hhmm_thu FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
          WHEN '5' THEN COALESCE(
            (SELECT cutoff_hhmm_fri_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT cutoff_hhmm_fri FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
          WHEN '6' THEN COALESCE(
            (SELECT cutoff_hhmm_sat_override FROM store_vendor_overrides o
             WHERE o.vendor_id = l.vendorId AND o.store_id = l.storeId),
            (SELECT cutoff_hhmm_sat FROM vendor_weekly_rules v
             WHERE v.vendor_id = l.vendorId)
          )
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
        orderable_raw AS orderable,
        cutoffHHmm_raw AS cutoffHHmm
      FROM vw
    ),
    filtered AS (
      SELECT *
      FROM resolved
      WHERE (@df = '' OR orderDate >= @df)   -- ★ 発注日で絞り込む
        AND (@dt = '' OR orderDate <= @dt)   -- ★ ここも同様
        AND (@vid IS NULL OR vendorId = @vid)
        AND (COALESCE(@did,'') = '' OR storeId = @did)
        -- 発注可能な曜日だけ
        AND COALESCE(orderable, 1) = 1
        -- 締切を過ぎたものだけ（asOf 未指定ならスキップ）
        AND (
          @asOf = ''
          OR
            CASE
              -- cutoff が「早朝（04:00 より前）」なら、翌日にずらす
               WHEN COALESCE(cutoffHHmm, '23:59') <= '04:00' THEN
                datetime(orderDate || ' ' || COALESCE(cutoffHHmm, '23:59'), '+1 day')
              -- それ以外（04:00 以降）は orderDate 当日の時刻として扱う
              ELSE
                datetime(orderDate || ' ' || COALESCE(cutoffHHmm, '23:59'))
            END
            <= datetime(@asOf)
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

    // ★ デバッグログ（締切判定の挙動チェック用）
  console.log("[generateShipmentsInternal] params:", {
    asOf,
    df,
    dt,
    vendorId: vid,
    destinationId: did,
    totalRows: src.length,
  });

  console.log(
    "[generateShipmentsInternal] sample rows:",
    src.slice(0, 20).map((r) => ({
      orderId: r.orderId,
      storeId: r.storeId,
      vendorId: r.vendorId,
      orderDate: r.orderDate,
      deliveryDate: r.deliveryDate,
      cutoffHHmm: r.cutoffHHmm,
      orderable: r.orderable,
      qty: r.qty,
    }))
  );

  // ひとつも対象が無いなら、preview も 0/0 で返却
  if (!src.length) {
    return {
      ok: true,
      countHeaders: 0,
      countLines: 0,
      headersAffected: 0,
      linesAffected: 0,
      // 旧フロント互換用
      createdHeaders: 0,
      upsertedLines: 0,
      // 新規：スキップ数（確定済みのため生成対象外）
      skippedHeaders: 0,
      skippedLines: 0,
    };
  }

  // 既存出荷（shipments）の状態を確認するクエリ
  const getHeader = db.prepare(
    `
    SELECT id, status
      FROM shipments
     WHERE vendor_id      = @vendorId
       AND destination_id = @destinationId
       AND delivery_date  = @deliveryDate
       AND COALESCE(order_date, delivery_date) = @orderDate
    `
  );

  // ===== プレビュー（dryRun=true） =====
  if (dryRun) {
    // key: "vendorId|storeId|deliveryDate" -> status ("open" / "confirmed" / "canceled" / "none")
    const headerStatusMap = new Map<string, string>();

    for (const r of src) {
      const key = `${r.vendorId}|${r.storeId}|${r.orderDate}|${r.deliveryDate}`;
      // const key = `${r.vendorId}|${r.storeId}|${r.deliveryDate}`;
      if (!headerStatusMap.has(key)) {
        const existing = getHeader.get({
          vendorId: r.vendorId,
          destinationId: r.storeId,
          deliveryDate: r.deliveryDate,
          orderDate: r.orderDate,
        }) as { id?: number; status?: string } | undefined;
        headerStatusMap.set(key, existing?.status ?? "none");
      }
    }

    const effectiveHeaderKeys = new Set<string>();
    let countLines = 0;
    let skippedLines = 0;

    for (const r of src) {
      const key = `${r.vendorId}|${r.storeId}|${r.orderDate}|${r.deliveryDate}`;
      // const key = `${r.vendorId}|${r.storeId}|${r.deliveryDate}`;
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
    };
  }

  // ===== 本処理：shipments / shipment_lines へ UPSERT =====

  const getStoreName = db.prepare(
    `
    SELECT name
      FROM stores
     WHERE id = ?
    `
  );

  const insHeader = db.prepare(
    `
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
  // 差し替え　カウントの定義を揃えるパッチ start
  let createdHeaders = 0;
  let upsertedLines = 0;
  let skippedHeaders = 0;
  let skippedLines = 0;

  const headerKeyToId = new Map<string, number>();
  const headerKeyToStatus = new Map<string, string>();
  const touchedHeaderKeys = new Set<string>(); // ★ 対象になったヘッダキー

  const tx = db.transaction(() => {
    for (const r of src) {
      // const key = `${r.vendorId}|${r.storeId}|${r.deliveryDate}`;
      const key = `${r.vendorId}|${r.storeId}|${r.orderDate}|${r.deliveryDate}`;

      let headerId = headerKeyToId.get(key);
      let status = headerKeyToStatus.get(key);

      if (headerId == null) {
        const existing = getHeader.get({
          vendorId: r.vendorId,
          destinationId: r.storeId,
          deliveryDate: r.deliveryDate,
          orderDate: r.orderDate,
        }) as { id?: number; status?: string } | undefined;

        if (existing?.id) {
          headerId = existing.id;
          status = existing.status ?? "open";
        } else {
          // 新規ヘッダ作成
          const store = getStoreName.get(r.storeId) as { name?: string } | undefined;
          const destinationName = store?.name ?? null;

          insHeader.run({
            vendorId: r.vendorId,
            destinationId: r.storeId,
            destinationName,
            orderDate: r.orderDate,  // ★ 追加
            deliveryDate: r.deliveryDate,
          });
          createdHeaders++;

          const h = getHeader.get({
            vendorId: r.vendorId,
            destinationId: r.storeId,
            deliveryDate: r.deliveryDate,
            orderDate: r.orderDate,
          }) as { id: number; status?: string };

          headerId = h.id;
          status = h.status ?? "open";
        }

        headerKeyToId.set(key, headerId);
        headerKeyToStatus.set(key, status!);
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

    // 確定済みヘッダ数
    skippedHeaders = Array.from(headerKeyToStatus.values()).filter(
      (s) => s === "confirmed"
    ).length;
  });

  tx();

  const headersAffected = touchedHeaderKeys.size;

  return {
    ok: true,
    headersAffected,          // 対象ヘッダ数（既存 + 新規）
    linesAffected: upsertedLines,
    countHeaders: headersAffected,
    countLines: upsertedLines,
    skippedHeaders,
    skippedLines,
    // 旧フロント互換用
    createdHeaders,           // 純粋な「新規ヘッダ作成数」
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
