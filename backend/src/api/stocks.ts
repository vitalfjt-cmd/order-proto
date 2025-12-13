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
  spec: string | null;
  unit: string | null;
  openingQty: number;
  receiptQty: number;
  issueQty: number;
  adjustmentQty: number;
  closingQty: number;
};

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

    const sql = `
      WITH params AS (
        SELECT
          @storeId AS store_id,
          @month || '-01' AS month_start,
          date(@month || '-01', '+1 month', '-1 day') AS month_end,
          date(@month || '-01', '-1 day') AS prev_day
      ),
      movements_with_sign AS (
        SELECT
          m.store_id,
          m.item_id,
          m.movement_date,
          CASE
            WHEN m.movement_type = 'SHIPMENT' THEN -m.qty
            ELSE m.qty
          END AS signed_qty,
          m.movement_type
        FROM store_stock_movements m
        JOIN params p
          ON m.store_id = p.store_id
      ),
      agg AS (
        SELECT
          m.store_id,
          m.item_id,
          SUM(
            CASE
              WHEN m.movement_date <= p.prev_day
              THEN m.signed_qty
              ELSE 0
            END
          ) AS opening_qty,
          SUM(
            CASE
              WHEN m.movement_date BETWEEN p.month_start AND p.month_end
                  AND m.signed_qty > 0
              THEN m.signed_qty
              ELSE 0
            END
          ) AS receipt_qty,
          SUM(
            CASE
              WHEN m.movement_date BETWEEN p.month_start AND p.month_end
                  AND m.signed_qty < 0
              THEN -m.signed_qty      -- 出庫は絶対値
              ELSE 0
            END
          ) AS issue_qty,
          SUM(
            CASE
              WHEN m.movement_date BETWEEN p.month_start AND p.month_end
                  AND m.movement_type = 'ADJUSTMENT'
              THEN m.signed_qty
              ELSE 0
            END
          ) AS adjustment_qty,
          SUM(
            CASE
              WHEN m.movement_date <= p.month_end
              THEN m.signed_qty
              ELSE 0
            END
          ) AS closing_qty
        FROM movements_with_sign m
        JOIN params p
        GROUP BY m.store_id, m.item_id
      )
      SELECT
        a.store_id                         AS storeId,
        a.item_id                          AS itemId,
        i.name                             AS itemName,
        i.spec                             AS spec,
        COALESCE(i.stock_unit, i.unit)     AS unit,
        a.opening_qty                      AS openingQty,
        a.receipt_qty                      AS receiptQty,
        a.issue_qty                        AS issueQty,
        a.adjustment_qty                   AS adjustmentQty,
        a.closing_qty                      AS closingQty
      FROM agg a
      JOIN items i
        ON i.id = a.item_id
      WHERE
        a.opening_qty       != 0
        OR a.receipt_qty    != 0
        OR a.issue_qty      != 0
        OR a.adjustment_qty != 0
        OR a.closing_qty    != 0
      ORDER BY a.item_id
    `;

    const stmt = db.prepare(sql);

    const rows = stmt.all({
      storeId,
      month: rawMonth,
    }) as StoreMonthlySummaryRow[];

    res.json({
      ok: true,
      storeId,
      month: rawMonth,
      rows,
    });
  } catch (err) {
    console.error("[GET /stocks/monthly-summary] error", err);
    res.status(500).json({ ok: false, error: "internal error" });
  }
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
        };
      })
      .filter(
        (ln) =>
          ln.itemId &&
          Number.isFinite(ln.closingQty) &&
          Number.isFinite(ln.actualQty) &&
          ln.diffQty !== 0
      );

    if (diffLines.length === 0) {
      // 差異無しなら何もしない
      res.json({
        ok: true,
        storeId,
        month: rawMonth,
        inserted: 0,
      });
      return;
    }

    const insertSql = `
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
        date(@month || '-01', '+1 month', '-1 day'), -- 当月末
        'ADJUSTMENT',
        @qty,
        'stock_count',
        NULL,
        @memo,
        datetime('now','localtime'),
        datetime('now','localtime')
      )
    `;

    const insertStmt = db.prepare(insertSql);

    const tx = db.transaction(
      (
        lines: {
          itemId: string;
          diffQty: number;
        }[]
      ) => {
        for (const ln of lines) {
          insertStmt.run({
            storeId,
            month: rawMonth,
            itemId: ln.itemId,
            qty: ln.diffQty,
            memo: `stock_count ${rawMonth}`,
          });
        }
      }
    );

    tx(diffLines);

    res.json({
      ok: true,
      storeId,
      month: rawMonth,
      inserted: diffLines.length,
    });
  } catch (err: any) {
    console.error("[POST /stocks/monthly-adjust] error", err);
    res.status(500).json({
      ok: false,
      error: String(err?.message ?? err),
    });
  }
});

