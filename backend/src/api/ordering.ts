import { Router } from 'express';
import { db } from '../db';
import { ID } from '../lib/id';
import crypto from 'crypto';          // ★ これを追加
import { ymd } from '../lib/dates';   // ★ 日付文字列 "YYYY-MM-DD" 用

export const ordering = Router();

// === 発注：入力画面の検索（/ordering/entry）===
// App.tsx の doSearch() から呼ばれるメインAPI。
// ・店舗名 storeName
// ・ベンダー一覧 vendors
// ・品目一覧 items（itemId, name, spec, unit, vendorId, unitPrice）
// ・ベンダー別の締め/リードタイム rules.perVendor
// ・draft や order があれば mergedLines として既存数量も返す
// 使用テーブル：
//   stores           … 店舗名取得
//   vendors          … ベンダー一覧
//   items, item_prices など … 発注候補品目＋単価
//   orders, order_lines, order_drafts … 既存発注・ドラフトのマージ
ordering.get('/entry', (req, res) => {
  try {
    // 1) storeId / orderDate の取得・正規化
    const rawStoreId = String(req.query.storeId || '').trim();
    const orderDate  = String(req.query.orderDate || '').trim(); // YYYY-MM-DD
    const storeId    = ID.store(rawStoreId);

    if (!storeId || !orderDate) {
      return res.status(400).json({ error: 'storeId and orderDate required' });
    }

    // 営業日＝今回の orderDate（旧実装と同じ）
    const businessDate = orderDate;

    // 曜日（0=Sun ... 6=Sat）
    const weekdayFromYmd = (ymd: string): number => {
      const [y, m, d] = ymd.split('-').map(x => Number(x));
      const dt = new Date(y, m - 1, d);
      return dt.getDay(); // 0..6
    };
    const weekday = weekdayFromYmd(businessDate);

    // 2) アクティブ店舗一覧（is_active=1 のみ）
    const stores = db.prepare(`
      SELECT id, name
        FROM stores
       WHERE is_active = 1
       ORDER BY id
    `).all() as { id: string; name: string }[];

    // 3) この店舗でこの日に発注候補になるベンダー一覧
    const vendorCandidates = db.prepare(`
      SELECT DISTINCT svi.vendor_id AS vendor_id
        FROM store_vendor_items svi
       WHERE svi.store_id = ?
         AND svi.valid_from <= ?
         AND (svi.valid_to IS NULL OR svi.valid_to >= ?)
       ORDER BY svi.vendor_id
    `).all(storeId, businessDate, businessDate) as { vendor_id: string }[];

    // vendors マスタから名前を取る
    const activeVendors = vendorCandidates.map(v => {
      const row = db.prepare(`
        SELECT id, name FROM vendors WHERE id = ?
      `).get(v.vendor_id) as { id: string; name: string } | undefined;
      return row || { id: v.vendor_id, name: v.vendor_id };
    });

    // 4) ベンダーごとのルールを weekday 単位で解決
    function pickRuleForStoreAndVendor(storeId: string, vendorId: string, weekday: number) {
      const wr = db.prepare(`
        SELECT *
          FROM vendor_weekly_rules
         WHERE vendor_id = ?
      `).get(vendorId) as any || {};

      const ov = db.prepare(`
        SELECT *
          FROM store_vendor_overrides
         WHERE store_id = ?
           AND vendor_id = ?
      `).get(storeId, vendorId) as any || {};

      const dayKeys = ['sun','mon','tue','wed','thu','fri','sat'] as const;
      const key = dayKeys[weekday]; // 'sun' | 'mon' | ...

      const base_orderable      = wr[`orderable_${key}`];
      const base_cutoff         = wr[`cutoff_hhmm_${key}`];
      const base_lead_time_days = wr[`lead_time_days_${key}`];

      const ov_orderable      = ov[`orderable_${key}_override`];
      const ov_cutoff         = ov[`cutoff_hhmm_${key}_override`];
      const ov_lead_time_days = ov[`lead_time_days_${key}_override`];

      const orderable = (ov_orderable !== null && ov_orderable !== undefined)
        ? ov_orderable
        : base_orderable;
      const cutoffHHmm = (ov_cutoff !== null && ov_cutoff !== undefined && ov_cutoff !== '')
        ? ov_cutoff
        : base_cutoff;
      const leadTimeDays = (ov_lead_time_days !== null && ov_lead_time_days !== undefined)
        ? ov_lead_time_days
        : base_lead_time_days;

      return {
        orderable: !!orderable && Number(orderable) !== 0,
        cutoffHHmm: cutoffHHmm || '04:00',
        leadTimeDays: (leadTimeDays ?? 1),
      };
    }

    const perVendorRule: Record<string, { orderable: boolean; cutoffHHmm: string; leadTimeDays: number }> = {};
    for (const v of activeVendors) {
      perVendorRule[v.id] = pickRuleForStoreAndVendor(storeId, v.id, weekday);
    }

    // 5) 今日この店で実際に発注可能なベンダーだけを抽出
    const orderableVendorIds = activeVendors
      .filter(v => perVendorRule[v.id]?.orderable)
      .map(v => v.id);

    // 6) 発注可能ベンダーがこの店舗に供給する品目＋価格
    const itemsRowsRaw = db.prepare(`
      SELECT
        svi.vendor_id  AS vendor_id,
        svi.item_id    AS item_id,
        i.name         AS name,
        i.spec         AS spec,
        i.unit         AS unit
      FROM store_vendor_items svi
      JOIN items i ON i.id = svi.item_id
     WHERE svi.store_id = ?
       AND svi.valid_from <= ?
       AND (svi.valid_to IS NULL OR svi.valid_to >= ?)
     ORDER BY svi.vendor_id, svi.item_id
    `).all(storeId, businessDate, businessDate) as {
      vendor_id: string;
      item_id: string;
      name: string;
      spec: string;
      unit: string;
    }[];

    function pickUnitPrice(vendorId: string, itemId: string, ymdDate: string): number | null {
      const row = db.prepare(`
        SELECT p.unit_price AS price
          FROM item_prices p
         WHERE p.vendor_id = ?
           AND p.item_id   = ?
           AND p.valid_from <= ?
           AND (p.valid_to IS NULL OR p.valid_to >= ?)
         ORDER BY p.valid_from DESC
         LIMIT 1
      `).get(vendorId, itemId, ymdDate, ymdDate) as { price?: number } | undefined;
      if (!row || row.price === undefined || row.price === null) return null;
      return Number(row.price);
    }

    const filteredByVendorRule = itemsRowsRaw.filter(r => orderableVendorIds.includes(r.vendor_id));

    // 7) 既存注文ヘッダ（vendor_mode='all', vendor_id IS NULL）を探す
    const existingOrderHeader = db.prepare(`
      SELECT *
        FROM orders
       WHERE store_id    = ?
         AND vendor_mode = 'all'
         AND vendor_id IS NULL
         AND order_date  = ?
       LIMIT 1
    `).get(storeId, businessDate) as any || null;

    // 既存明細を item_id -> { qty, expectedArrivalDate } に
    const existingLinesMap: Record<string, { qty: number; expectedArrivalDate: string | null }> = {};
    if (existingOrderHeader) {
      const exLines = db.prepare(`
        SELECT item_id, qty, expected_arrival_date
          FROM order_lines
         WHERE order_id = ?
      `).all(existingOrderHeader.id) as {
        item_id: string;
        qty: number;
        expected_arrival_date: string | null;
      }[];

      for (const ln of exLines) {
        existingLinesMap[ln.item_id] = {
          qty: ln.qty,
          expectedArrivalDate: ln.expected_arrival_date,
        };
      }
    }

    // 7-3) 画面に返す行を構築
    const mergedLines: {
      lineId: string;
      itemId: string;
      qty: number;
      unitPrice: number;
      vendorId: string;
      expectedArrivalDate: string | null;
    }[] = [];

    for (const r of filteredByVendorRule) {
      const up = pickUnitPrice(r.vendor_id, r.item_id, businessDate);
      const fallback = existingLinesMap[r.item_id];
      mergedLines.push({
        lineId: `ln-${r.item_id}`,
        itemId: r.item_id,
        qty: fallback ? fallback.qty : 0,
        unitPrice: up ?? 0,
        vendorId: r.vendor_id,
        expectedArrivalDate: fallback ? fallback.expectedArrivalDate : null,
      });
    }

    // 8) 画面側ステータス
    let editable = true;
    let reason = '';
    if (orderableVendorIds.length === 0) {
      editable = false;
      reason = '本日は発注できないベンダーのみです。';
    }

    // 8.5) CSV用 名称マップ
    const storeName =
      stores.find(s => s.id === storeId)?.name ?? '';

    const vendorNames: Record<string, string> =
      Object.fromEntries(activeVendors.map(v => [v.id, v.name ?? '']));

    const itemNames: Record<string, string> = {};
    for (const r of itemsRowsRaw) {
      if (r.item_id && itemNames[r.item_id] == null) {
        itemNames[r.item_id] = r.name ?? '';
      }
    }

    // 9) レスポンス（旧 /ordering/entry と同じ形）
    return res.json({
      stores, // [{id,name}, ...]
      vendors: activeVendors,
      rules: {
        selected: null,
        perVendor: perVendorRule,
      },
      items: mergedLines.map(m => ({
        itemId: m.itemId,
        name: itemsRowsRaw.find(ir => ir.item_id === m.itemId)?.name ?? m.itemId,
        spec: itemsRowsRaw.find(ir => ir.item_id === m.itemId)?.spec ?? '',
        unit: itemsRowsRaw.find(ir => ir.item_id === m.itemId)?.unit ?? '',
        vendorId: m.vendorId,
        unitPrice: m.unitPrice,
      })),
      draft: {
        exists: !!existingOrderHeader,
        lines: mergedLines,
      },
      order: {
        exists: !!existingOrderHeader,
        lines: mergedLines,
      },
      status: {
        editable,
        reason,
      },
      storeName,
      vendorNames,
      itemNames,
    });
  } catch (err) {
    console.error('[/ordering/entry] failed:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

/** 発注：履歴一覧（/ordering/list）
 * HistoryPage.tsx の load() から呼ばれる。
 * クエリ: storeId, from/start, to/end
 * 戻り値:
 *   {
 *     total: number,
 *     items: [{ id, storeId, vendorId, orderDate, lineCount, total }, ...],
 *     summary: { total, count }
 *   }
 */
ordering.get('/list', (req, res) => {
  // 旧 server.ts と同じクエリ解釈
  const { storeId, from, start, to, end } = req.query as any;
  const qFrom = from ?? start ?? null;
  const qTo   = to   ?? end   ?? null;

  // 行数集計付きの一覧
  const rows = db.prepare(`
    SELECT
      o.id           AS id,
      o.store_id     AS storeId,
      o.vendor_id    AS vendorId,
      o.order_date   AS orderDate,
      COALESCE(x.lineCount, 0) AS lineCount,
      o.total        AS total
    FROM orders o
    LEFT JOIN (
      SELECT ol.order_id AS orderId, COUNT(*) AS lineCount
        FROM order_lines ol
       GROUP BY ol.order_id
    ) x ON x.orderId = o.id
    WHERE (? IS NULL OR o.store_id = ?)
      AND (? IS NULL OR o.order_date >= ?)
      AND (? IS NULL OR o.order_date <= ?)
    ORDER BY o.order_date DESC, o.id DESC
  `).all(
    storeId ?? null, storeId ?? null,
    qFrom ?? null,   qFrom ?? null,
    qTo ?? null,     qTo ?? null
  );

  // 件数と合計の要約（旧仕様どおり）
  const summary = rows.reduce(
    (acc: { total: number; count: number }, r: any) => {
      acc.total += Number(r.total || 0);
      acc.count += 1;
      return acc;
    },
    { total: 0, count: 0 }
  );

  res.json({ total: rows.length, items: rows, summary });
});

/** 注文詳細（HistoryPage 用モーダル） */
ordering.get('/detail', (req, res) => {
  const orderId = String(req.query.orderId || '');

  const header = db.prepare(`
    SELECT
      o.id,
      o.store_id AS storeId,
      o.vendor_id AS vendorId,
      o.order_date AS orderDate,
      o.expected_arrival_date AS expectedArrivalDate,
      o.subtotal,
      o.tax,
      o.total
    FROM orders o
    WHERE o.id = ?
  `).get(orderId);

  const lines = db.prepare(`
    SELECT
      ol.item_id AS itemId,
      (SELECT name FROM items i WHERE i.id = ol.item_id) AS itemName,
      ol.qty        AS qty,
      ol.unit_price AS unitPrice,
      ol.amount     AS amount
    FROM order_lines ol
    WHERE ol.order_id = ?
    ORDER BY ol.id
  `).all(orderId);

  res.json({ header, lines });
});

/** 発注：明細CSVエクスポート（/ordering/export_lines）
 * HistoryPage.tsx の「CSVダウンロード」ボタンから呼ばれる。
 * 期間内の注文を store/vendor/item 単位でフラットに返す。
 *
 * クエリ:
 *   storeId (任意)
 *   from / start (開始日)
 *   to / end     (終了日)
 *
 * 戻り値:
 *   { items: ExportLine[] }
 *   ExportLine は HistoryPage.tsx 側で
 *   orderId, storeId, storeName, vendorId, vendorName,
 *   orderDate, itemId, itemName, qty, unitPrice, amount
 *   を期待している。
 */
ordering.get('/export_lines', (req, res) => {
  const { storeId, from, start, to, end } = req.query as any;
  const qFrom = from ?? start ?? null;
  const qTo   = to   ?? end   ?? null;

  const rows = db.prepare(`
    SELECT
      o.id           AS orderId,
      o.store_id     AS storeId,
      s.name         AS storeName,
      o.vendor_id    AS vendorId,
      v.name         AS vendorName,
      o.order_date   AS orderDate,
      ol.item_id     AS itemId,
      i.name         AS itemName,
      ol.qty         AS qty,
      ol.unit_price  AS unitPrice,
      ol.amount      AS amount
    FROM orders o
    JOIN order_lines ol ON ol.order_id = o.id
    LEFT JOIN stores  s ON s.id = o.store_id
    LEFT JOIN vendors v ON v.id = o.vendor_id
    LEFT JOIN items   i ON i.id = ol.item_id
    WHERE (? IS NULL OR o.store_id = ?)
      AND (? IS NULL OR o.order_date >= ?)
      AND (? IS NULL OR o.order_date <= ?)
    ORDER BY o.order_date DESC, o.id DESC, ol.id
  `).all(
    storeId ?? null, storeId ?? null,
    qFrom ?? null,   qFrom ?? null,
    qTo ?? null,     qTo ?? null
  );

  res.json({ items: rows });
});

/** 発注：送信（/ordering/submit）
 * App.tsx の handleSend() から呼び出される。
 * 受け取る JSON: {
 *   storeId, vendorMode, vendorId, orderDate, expectedArrivalDate, taxRate,
 *   lines: [{ itemId, qty, unitPrice, vendorId, expectedArrivalDate }, ...]
 * }
 * やること:
 *   1. バリデーション
 *   2. 明細行を正規化（ID整形・金額計算・納品予定日の補完）
 *   3. orders / order_lines を UPSERT（既存あれば更新、なければ新規）
 *   4. 合計金額等を返す
 */
ordering.post('/submit', (req, res) => {
  type LineIn = {
    itemId: string;
    qty: number;
    unitPrice?: number;
    vendorId?: string;
    expectedArrivalDate?: string | null;
  };

  type Dto = {
    storeId: string;
    vendorMode: 'all' | 'single';
    vendorId: string | null;
    orderDate: string; // "YYYY-MM-DD"
    expectedArrivalDate?: string | null;
    taxRate?: number;
    lines: LineIn[];
  };

  const b = (req.body || {}) as Dto;
  const errors: string[] = [];

  const rawLines = Array.isArray(b.lines) ? b.lines : [];
  const lines = rawLines.filter((ln) => Number.isInteger(ln?.qty) && ln.qty > 0);

  if (!b.storeId) errors.push('storeId は必須です。');
  if (!b.orderDate) errors.push('orderDate は必須です。');
  if (!Array.isArray(b.lines) || b.lines.length === 0) errors.push('lines は1件以上が必要です。');
  if (b.vendorMode === 'single' && !b.vendorId) {
    errors.push("vendorMode='single' の場合 vendorId は必須です。");
  }

  (b.lines || []).forEach((ln, i) => {
    if (!ln?.itemId) errors.push(`lines[${i}].itemId がありません。`);
    if (!Number.isInteger(ln?.qty) || ln.qty <= 0) {
      errors.push(`lines[${i}].qty は 1 以上の整数です。`);
    }
  });

  if (errors.length) {
    return res.status(400).json({ status: 'error', errors });
  }

  // ---- 正規化 ----
  const storeId = ID.store(b.storeId);
  const vendorMode: 'all' | 'single' = b.vendorMode === 'single' ? 'single' : 'all';
  const headerVendorId = vendorMode === 'single' && b.vendorId ? ID.vendor(b.vendorId) : null;
  const orderDate = b.orderDate;
  const taxRate = typeof b.taxRate === 'number' ? b.taxRate : 0.1;

  const addDays = (ymdStr: string, days: number): string => {
    const d = new Date(ymdStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return ymd(d);
  };

  let subtotal = 0;

  const normalizedLines = lines.map((ln) => {
    const itemId = ID.item(ln.itemId);
    const qty = Number(ln.qty || 0);

    // 行に vendorId があれば優先、なければヘッダの vendorId（single モード用）
    const vendorId =
      (ln.vendorId && ln.vendorId.trim()) || (headerVendorId ?? undefined);

    const unitPrice = Number(ln.unitPrice ?? 0);
    const amount = unitPrice * qty;
    subtotal += amount;

    // 納品予定日：行＞ヘッダ＞orderDate+1日
    let expectedArrivalDate =
      ln.expectedArrivalDate ?? b.expectedArrivalDate ?? null;
    if (!expectedArrivalDate) {
      expectedArrivalDate = addDays(orderDate, 1);
    }

    return {
      itemId,
      qty,
      unitPrice,
      amount,
      vendorId: vendorId ?? null,
      expectedArrivalDate,
    };
  });

  const tax = Math.round(subtotal * taxRate);
  const total = subtotal + tax;

  // ---- 簡易 idempotency（同じ内容なら同じ orderId になる）----
  const key = {
    storeId,
    vendorMode,
    vendorId: headerVendorId,
    orderDate,
    lines: normalizedLines.map((l) => ({
      itemId: l.itemId,
      qty: l.qty,
      unitPrice: l.unitPrice,
      vendorId: l.vendorId,
    })),
    subtotal,
    tax,
    total,
  };
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(key))
    .digest('hex');
  const newOrderId = `O${ymd(new Date())}-${hash.slice(0, 8)}`;

  // ---- 永続化（UPSERT）----
  try {
    const now = new Date().toISOString();

    // 既存注文（同一ビジネスキー）があるか？
    const existing = db
      .prepare(
        `SELECT id FROM orders
          WHERE store_id = ?
            AND vendor_mode = ?
            AND (vendor_id IS ? OR vendor_id = ?)
            AND order_date = ?`
      )
      .get(
        storeId,
        vendorMode,
        headerVendorId ?? null,
        headerVendorId ?? null,
        orderDate
      ) as { id?: string } | undefined;

    const targetOrderId = existing?.id ?? newOrderId;

    const tx = db.transaction(() => {
      if (existing?.id) {
        // 既存ヘッダ更新
        db.prepare(
          `UPDATE orders
              SET expected_arrival_date = ?,
                  subtotal = ?,
                  tax = ?,
                  total = ?,
                  tax_rate = ?,
                  updated_at = ?
            WHERE id = ?`
        ).run(
          b.expectedArrivalDate ?? null,
          subtotal,
          tax,
          total,
          taxRate,
          now,
          targetOrderId
        );

        // 旧明細を全削除
        db.prepare(`DELETE FROM order_lines WHERE order_id = ?`).run(
          targetOrderId
        );
      } else {
        // 新規ヘッダ
        db.prepare(
          `INSERT INTO orders
             (id, store_id, vendor_id, vendor_mode, order_date, expected_arrival_date,
              subtotal, tax, total, tax_rate, created_at, updated_at)
           VALUES (?,  ?,        ?,         ?,          ?,                ?,
                   ?,      ?,    ?,      ?,       ?,          ?)`
        ).run(
          targetOrderId,
          storeId,
          headerVendorId ?? null,
          vendorMode,
          orderDate,
          b.expectedArrivalDate ?? null,
          subtotal,
          tax,
          total,
          taxRate,
          now,
          now
        );
      }

      // 明細を再投入
      const lineStmt = db.prepare(
        `INSERT INTO order_lines
           (order_id, item_id, qty, unit_price, amount, expected_arrival_date, vendor_id)
         VALUES (?,        ?,       ?,   ?,          ?,      ?,                   ?)`
      );

      for (const l of normalizedLines) {
        lineStmt.run(
          targetOrderId,
          l.itemId,
          l.qty,
          l.unitPrice,
          l.amount,
          l.expectedArrivalDate,
          l.vendorId ?? null
        );
      }
    });

    tx();

    console.log(
      `[DB] order ${existing ? 'updated' : 'inserted'}: ${targetOrderId} (${normalizedLines.length} lines)`
    );

    return res.status(existing ? 200 : 201).json({
      status: existing ? 'updated' : 'accepted',
      orderId: targetOrderId,
      totals: { subtotal, tax, total, taxRate },
      acceptedLines: normalizedLines.length,
    });
  } catch (e) {
    console.error('[DB] upsert failed', e);
    return res
      .status(500)
      .json({ status: 'error', error: 'DB upsert failed' });
  }
});
