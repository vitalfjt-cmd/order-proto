// backend/src/api/stocks.ts
import { Router } from "express";
import { db } from "../db";

export const stocks = Router();

type StoreStockRow = {
  storeId: string;
  itemId: string;
  itemName: string | null;
  spec: string | null;
  unit: string | null;
  qty: number;
};

// 月次サマリ（棚卸）1行分
type StoreMonthlySummaryRow = {
  storeId: string;
  itemId: string;
  itemName: string | null;
  // spec: string | null;
  unit: string | null;
  openingQty: number;
  receiptQty: number;
  issueQty: number;
  adjustmentQty: number;
  closingQty: number;
  unitCost: number | null; // ★ 追加：在庫単位あたり総平均単価
};

type ValuationMethod = "TOTAL_AVG" | "MOVING_AVG";

function getValuationMethod(db: any, storeId: string): ValuationMethod {
  const row = db
    .prepare(`SELECT method FROM stock_valuation_settings WHERE store_id = ?`)
    .get(storeId) as { method?: string } | undefined;

  return row?.method === "MOVING_AVG" ? "MOVING_AVG" : "TOTAL_AVG";
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

stocks.get("/store-stocks", (req, res) => {
  try {
    const storeIdRaw =
      typeof req.query.storeId === "string" ? req.query.storeId : "";
    const keywordRaw =
      typeof req.query.keyword === "string" ? req.query.keyword : "";
    const asOfRaw =
      typeof req.query.asOf === "string" ? req.query.asOf : "";

    const storeId = storeIdRaw.replace(/\D/g, "").padStart(4, "0");
    if (!storeId) {
      res.status(400).json({ ok: false, error: "storeId is required" });
      return;
    }

    // asOf: YYYY-MM-DD 形式なら採用、そうでなければ今日
    let asOf = asOfRaw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      asOf = todayYmd();
    }

    const hasKeyword = keywordRaw.trim().length > 0;
    const keyword = `%${keywordRaw.trim()}%`;

    const sql = `
      SELECT
        m.store_id     AS storeId,
        m.item_id      AS itemId,
        COALESCE(SUM(
          CASE
            WHEN m.movement_type = 'SHIPMENT' THEN -m.qty  -- 出庫はマイナス
            ELSE m.qty                                     -- RECEIPTなどはプラス
          END
        ), 0) AS qty,
        i.name         AS itemName,
        i.spec         AS spec,
        COALESCE(i.stock_unit, i.unit) AS unit
      FROM store_stock_movements m
      LEFT JOIN items i
        ON i.id = m.item_id
      WHERE m.store_id = @storeId
        AND m.movement_date <= @asOf
        ${hasKeyword ? "AND (i.name LIKE @keyword OR i.spec LIKE @keyword OR m.item_id LIKE @keyword)" : ""}
      GROUP BY m.store_id, m.item_id
      HAVING qty <> 0
      ORDER BY m.item_id
    `;

    const params: any = { storeId, asOf };
    if (hasKeyword) {
      params.keyword = keyword;
    }

    const rows = db.prepare<StoreStockRow>(sql).all(params);

    res.json({
      ok: true,
      storeId,
      asOf,
      rows,
    });
  } catch (e: any) {
    console.error("[/stocks/store-stocks] error:", e);
    res
      .status(500)
      .json({ ok: false, error: String(e?.message ?? e) });
  }
});

stocks.get("/monthly-summary", (req, res) => {
  try {
    const rawStoreId = String(req.query.storeId ?? "").trim();
    const rawMonth = String(req.query.month ?? "").trim(); // 'YYYY-MM' 想定

    const storeId = rawStoreId.padStart(4, "0");

    if (!/^\d{4}$/.test(storeId) || !/^\d{4}-\d{2}$/.test(rawMonth)) {
      res.status(400).json({ ok: false, error: "invalid parameters" });
      return;
    }

    const valuationMethod = getValuationMethod(db, storeId);

    const sql = `
      WITH params AS (
        SELECT
          @storeId AS store_id,
          @month || '-01' AS month_start,
          date(@month || '-01', '+1 month', '-1 day') AS month_end,
          date(@month || '-01', '-1 day') AS prev_day,
          @method AS method
      ),

      movements_with_sign AS (
        SELECT
          m.id,
          m.store_id,
          m.item_id,
          m.movement_date,
          m.movement_type,
          CASE
            WHEN m.movement_type = 'SHIPMENT' THEN -m.qty
            ELSE m.qty
          END AS signed_qty,
          -- 入庫金額（無ければ unit_cost*qty を採用）
          CASE
            WHEN m.movement_type = 'RECEIPT'
            THEN COALESCE(m.amount, (m.unit_cost * m.qty))
            ELSE NULL
          END AS receipt_amount
        FROM store_stock_movements m
        JOIN params p ON m.store_id = p.store_id
        WHERE m.movement_date <= (SELECT month_end FROM params)
      ),

      -- 月次の数量集計（あなたの既存ロジックと同等）
      agg AS (
        SELECT
          m.store_id,
          m.item_id,
          SUM(CASE WHEN m.movement_date <= p.prev_day THEN m.signed_qty ELSE 0 END) AS opening_qty,
          SUM(CASE WHEN m.movement_date BETWEEN p.month_start AND p.month_end AND m.signed_qty > 0 THEN m.signed_qty ELSE 0 END) AS receipt_qty,
          SUM(CASE WHEN m.movement_date BETWEEN p.month_start AND p.month_end AND m.signed_qty < 0 THEN -m.signed_qty ELSE 0 END) AS issue_qty,
          SUM(CASE WHEN m.movement_date BETWEEN p.month_start AND p.month_end AND m.movement_type = 'ADJUSTMENT' THEN m.signed_qty ELSE 0 END) AS adjustment_qty,
          SUM(CASE WHEN m.movement_date <= p.month_end THEN m.signed_qty ELSE 0 END) AS closing_qty
        FROM movements_with_sign m
        JOIN params p
        GROUP BY m.store_id, m.item_id
      ),

      -- 総平均（累計入庫金額/累計入庫数量）
      total_cost AS (
        SELECT
          m.store_id,
          m.item_id,
          SUM(CASE
                WHEN m.movement_type='RECEIPT' AND m.receipt_amount IS NOT NULL
                THEN COALESCE(m.signed_qty,0) ELSE 0 END) AS receipt_qty_cum,
          SUM(CASE
                WHEN m.movement_type='RECEIPT' AND m.receipt_amount IS NOT NULL
                THEN COALESCE(m.receipt_amount,0) ELSE 0 END) AS receipt_amt_cum
        FROM movements_with_sign m
        GROUP BY m.store_id, m.item_id
      ),

      /*
        移動平均（再帰CTE）
        状態：qty_on_hand, val_on_hand, avg_cost
        - RECEIPT: qty+=, val+=receipt_amount（無ければ unit_cost*qty）
        - SHIPMENT: qty-=, val-= (出庫数量 * 直前avg)
        - ADJUSTMENT: qty+=signed_qty, val+= (signed_qty * 直前avg)  ※差異は現平均で評価
      */
      ordered AS (
        SELECT
          m.*,
          ROW_NUMBER() OVER (PARTITION BY m.store_id, m.item_id ORDER BY m.movement_date, m.id) AS rn
        FROM movements_with_sign m
      ),

      movavg AS (
        -- 初回
        SELECT
          o.store_id,
          o.item_id,
          o.rn,
          o.id,
          o.movement_date,
          o.movement_type,
          o.signed_qty,
          o.receipt_amount,

          -- qty
          CASE
            WHEN o.movement_type='RECEIPT' THEN o.signed_qty
            WHEN o.movement_type='SHIPMENT' THEN o.signed_qty
            WHEN o.movement_type='ADJUSTMENT' THEN o.signed_qty
            ELSE o.signed_qty
          END AS qty_on_hand,

          -- value
          CASE
            WHEN o.movement_type='RECEIPT' THEN COALESCE(o.receipt_amount, 0)
            WHEN o.movement_type='SHIPMENT' THEN 0
            WHEN o.movement_type='ADJUSTMENT' THEN 0
            ELSE 0
          END AS val_on_hand,

          -- avg
          CASE
            WHEN (CASE WHEN o.movement_type='RECEIPT' THEN o.signed_qty ELSE o.signed_qty END) != 0
              AND o.movement_type='RECEIPT'
            THEN COALESCE(o.receipt_amount, 0) / o.signed_qty
            ELSE 0
          END AS avg_cost

        FROM ordered o
        WHERE o.rn = 1

        UNION ALL

        -- 2件目以降
        SELECT
          o.store_id,
          o.item_id,
          o.rn,
          o.id,
          o.movement_date,
          o.movement_type,
          o.signed_qty,
          o.receipt_amount,

          -- qty_on_hand
          (m.qty_on_hand + o.signed_qty) AS qty_on_hand,

          -- val_on_hand
          CASE
            WHEN o.movement_type='RECEIPT'
              THEN (m.val_on_hand + COALESCE(o.receipt_amount, 0))
            WHEN o.movement_type='SHIPMENT'
              THEN (m.val_on_hand + (o.signed_qty * m.avg_cost)) -- signed_qty は負なので減る
            WHEN o.movement_type='ADJUSTMENT'
              THEN (m.val_on_hand + (o.signed_qty * m.avg_cost))
            ELSE m.val_on_hand
          END AS val_on_hand,

          -- avg_cost（qty=0 のとき 0）
          CASE
            WHEN (m.qty_on_hand + o.signed_qty) = 0 THEN 0
            ELSE
              (
                CASE
                  WHEN o.movement_type='RECEIPT'
                    THEN (m.val_on_hand + COALESCE(o.receipt_amount, 0))
                  WHEN o.movement_type='SHIPMENT'
                    THEN (m.val_on_hand + (o.signed_qty * m.avg_cost))
                  WHEN o.movement_type='ADJUSTMENT'
                    THEN (m.val_on_hand + (o.signed_qty * m.avg_cost))
                  ELSE m.val_on_hand
                END
              ) / (m.qty_on_hand + o.signed_qty)
          END AS avg_cost

        FROM movavg m
        JOIN ordered o
          ON o.store_id = m.store_id
        AND o.item_id  = m.item_id
        AND o.rn = m.rn + 1
      ),

      moving_cost AS (
        SELECT
          store_id,
          item_id,
          -- 月末までの最終 avg_cost（=月末評価単価）
          (SELECT m2.avg_cost
            FROM movavg m2
            WHERE m2.store_id = movavg.store_id
              AND m2.item_id  = movavg.item_id
            ORDER BY m2.rn DESC
            LIMIT 1) AS mov_avg_cost
        FROM movavg
        GROUP BY store_id, item_id
      )

      SELECT
        a.store_id                     AS storeId,
        a.item_id                      AS itemId,
        i.name                         AS itemName,
        COALESCE(i.stock_unit, i.unit) AS unit,
        a.opening_qty                  AS openingQty,
        a.receipt_qty                  AS receiptQty,
        a.issue_qty                    AS issueQty,
        a.adjustment_qty               AS adjustmentQty,
        a.closing_qty                  AS closingQty,

        CASE
          WHEN (SELECT method FROM params) = 'MOVING_AVG'
            THEN mc.mov_avg_cost
          ELSE
            CASE
              WHEN COALESCE(tc.receipt_qty_cum, 0) > 0
              THEN tc.receipt_amt_cum / tc.receipt_qty_cum
              ELSE NULL
            END
        END AS unitCost

      FROM agg a
      JOIN items i
        ON i.id = a.item_id
      LEFT JOIN total_cost tc
        ON tc.store_id = a.store_id AND tc.item_id = a.item_id
      LEFT JOIN moving_cost mc
        ON mc.store_id = a.store_id AND mc.item_id = a.item_id
      WHERE
        a.opening_qty       != 0
        OR a.receipt_qty    != 0
        OR a.issue_qty      != 0
        OR a.adjustment_qty != 0
        OR a.closing_qty    != 0
      ORDER BY a.item_id
    `;

    const stmt = db.prepare(sql);
    const rows = stmt.all({ storeId, month: rawMonth, method: valuationMethod }) as StoreMonthlySummaryRow[];

    res.json({
      ok: true,
      storeId,
      month: rawMonth,
      valuationMethod,
      rows,
    });
  } catch (err) {
    console.error("[GET /stocks/monthly-summary] error", err);
    res.status(500).json({ ok: false, error: "internal error" });
  }
});

// GET /stocks/valuation-settings?storeId=0002
stocks.get("/valuation-settings", (req, res) => {
  const storeId = String(req.query.storeId ?? "");
  if (!storeId) return res.status(400).json({ error: "storeId is required" });

  const method = getValuationMethod(db, storeId);
  res.json({ storeId, method });
});

// POST /stocks/valuation-settings  { storeId:"0002", method:"MOVING_AVG" }
stocks.post("/valuation-settings", (req, res) => {
  const storeId = String(req.body?.storeId ?? "");
  const method = String(req.body?.method ?? "");

  if (!storeId) return res.status(400).json({ error: "storeId is required" });
  if (method !== "TOTAL_AVG" && method !== "MOVING_AVG") {
    return res.status(400).json({ error: "method must be TOTAL_AVG or MOVING_AVG" });
  }

  db.prepare(`
    INSERT INTO stock_valuation_settings (store_id, method, updated_at)
    VALUES (@storeId, @method, datetime('now','localtime'))
    ON CONFLICT(store_id) DO UPDATE SET
      method = excluded.method,
      updated_at = excluded.updated_at
  `).run({ storeId, method });

  res.json({ ok: true });
});

// 実棚入力 → ADJUSTMENT 反映
// POST /stocks/monthly-adjust
// body: { storeId: string, month: 'YYYY-MM', lines: { itemId, closingQty, actualQty }[] }
stocks.post("/monthly-adjust", (req, res) => {
  try {
    const body = (req.body || {}) as {
      storeId?: string;
      month?: string;
      lines?: {
        itemId?: string;
        closingQty?: number;
        actualQty?: number | null;
        unitCost?: number | null; // ★任意：ADJUSTMENT の評価単価（在庫単位）
      }[];
    };

    const rawStoreId = String(body.storeId ?? "").trim();
    const rawMonth = String(body.month ?? "").trim();

    const storeId = rawStoreId.replace(/\D/g, "").padStart(4, "0");

    if (!/^\d{4}$/.test(storeId) || !/^\d{4}-\d{2}$/.test(rawMonth)) {
      res.status(400).json({ ok: false, error: "invalid parameters" });
      return;
    }

    const inputLines = Array.isArray(body.lines) ? body.lines : [];

    // 差異のある品目だけを抽出
    const diffLines = inputLines
      .map((ln) => {
        const itemId = String(ln.itemId ?? "").trim();
        const closing = Number(ln.closingQty ?? 0);
        const actual =
          ln.actualQty === null || ln.actualQty === undefined
            ? closing
            : Number(ln.actualQty);
        const diff = actual - closing; // 実棚 - 帳簿 = ADJUSTMENT qty

        return {
          itemId,
          closingQty: closing,
          actualQty: actual,
          diffQty: diff,
          unitCost: ln.unitCost ?? null,
        };
      })
      .filter(
        (ln) =>
          ln.itemId &&
          Number.isFinite(ln.closingQty) &&
          Number.isFinite(ln.actualQty) &&
          ln.diffQty !== 0
      );

    const memo = `stock_count ${rawMonth}`;

    const deleteSql = `
      DELETE FROM store_stock_movements
      WHERE store_id = @storeId
        AND movement_type = 'ADJUSTMENT'
        AND ref_type = 'stock_count'
        AND memo = @memo
        AND movement_date = date(@month || '-01', '+1 month', '-1 day') -- 当月末
    `;
    const deleteStmt = db.prepare(deleteSql);

    const insertSql = `
      INSERT INTO store_stock_movements (
        store_id,
        item_id,
        movement_date,
        movement_type,
        qty,
        unit_cost,
        ref_type,
        ref_id,
        memo,
        created_at,
        updated_at
      )
      VALUES (
        @storeId,
        @itemId,
        date(@month || '-01', '+1 month', '-1 day'), -- 当月末
        'ADJUSTMENT',
        @qty,
        @unitCost,
        'stock_count',
        NULL,
        @memo,
        datetime('now','localtime'),
        datetime('now','localtime')
      )
    `;
    
    const findLastUnitCostStmt = db.prepare(`
      SELECT unit_cost AS unitCost
      FROM store_stock_movements
      WHERE store_id = @storeId
        AND item_id = @itemId
        AND unit_cost IS NOT NULL
      ORDER BY movement_date DESC, id DESC
      LIMIT 1
    `);

    const insertStmt = db.prepare(insertSql);

    // ★ここが肝：差分0でも delete は実行して、insert は0件で終わる
    const tx = db.transaction(
      (lines: { itemId: string; diffQty: number; unitCost: number | null }[]) => {
        const del = deleteStmt.run({ storeId, month: rawMonth, memo }).changes;

        for (const ln of lines) {
          // 優先順位：①入力unitCost ②直近movementのunit_cost
          let unitCost = Number(ln.unitCost ?? NaN);
          if (!(Number.isFinite(unitCost) && unitCost > 0)) {
            const r = findLastUnitCostStmt.get({ storeId, itemId: ln.itemId }) as { unitCost?: any } | undefined;
            const last = Number(r?.unitCost);
            unitCost = (Number.isFinite(last) && last > 0) ? last : NaN;
          }
          if (!(Number.isFinite(unitCost) && unitCost > 0)) {
            throw Object.assign(new Error("unit_cost_missing"), {
              code: "unit_cost_missing",
              itemId: ln.itemId,
            });
          }
          insertStmt.run({
            storeId,
            month: rawMonth,
            itemId: ln.itemId,
            qty: ln.diffQty,
            memo,
          });
        }
        return del;
      }
    );

    const deleted = tx(diffLines);

    res.json({
      ok: true,
      storeId,
      month: rawMonth,
      deleted,
      inserted: diffLines.length,
    });

  } catch (err: any) {
    console.error("[POST /stocks/monthly-adjust] error", err);
    if (err?.code === "unit_cost_missing") {
      res.status(409).json({
        ok: false,
        error: "unit_cost_missing",
        message: `ADJUSTMENT の単価が決められません（itemId=${String(err?.itemId ?? "")}）。直近単価が無い品目は unitCost を入力してください。`,
      });
      return;
    }
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

