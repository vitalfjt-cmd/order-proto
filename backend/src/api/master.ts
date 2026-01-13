import { Router } from 'express';
import { db } from '../db';
import { ID } from '../lib/id';

export const master = Router();

/** ベンダ一覧（VendorShipments/VendorEdit のモーダルで使用） */
master.get('/vendors', (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, name
        FROM vendors
       ORDER BY id
    `).all();
    // ★ 配列そのものを返す
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

/** 店舗一覧（VendorEdit の納品先モーダル） */
master.get('/stores', (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, name
        FROM stores
       WHERE is_active = 1
       ORDER BY id
    `).all();
    // ★ 配列そのものを返す（旧 server.ts と同じ）
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});
/** 全品目（フォールバック用） */
master.get('/items', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, name, unit, spec, temp_zone AS tempZone
      FROM items
     WHERE is_active = 1
     ORDER BY id
  `).all();
  res.json({ items: rows });
});

/** ベンダー取扱品目（重複除去：DISTINCT） */
master.get('/vendors/:vendorId/items', (req, res) => {
  try {
    const vendorId = ID.vendor(req.params.vendorId || '');
    const rows = db.prepare(`
      SELECT DISTINCT
        i.id AS id,
        i.name AS name,
        i.spec AS spec,
        i.unit AS unit,
        i.temp_zone AS tempZone
      FROM vendor_items vi
      JOIN items i ON i.id = vi.item_id
     WHERE vi.vendor_id = @vendorId
     ORDER BY i.id
    `).all({ vendorId });

    // ★ 配列そのものを返す（旧 server.ts と同じ）
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// === item_prices 管理（最小）====================================

type ItemPriceRow = {
  id: number;
  vendorId: string;
  itemId: string;
  unitPrice: number;
  validFrom: string;
  validTo: string | null;
};

function isYmd(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// YYYY-MM-DD 文字列比較でOK（同形式固定が前提）
function overlaps(aFrom: string, aTo: string | null, bFrom: string, bTo: string | null) {
  const aEnd = aTo ?? "9999-12-31";
  const bEnd = bTo ?? "9999-12-31";
  return aFrom <= bEnd && bFrom <= aEnd;
}

function toNullIfEmpty(s: any): string | null {
  const v = String(s ?? "").trim();
  return v === "" ? null : v;
}

/** item_prices 一覧（vendorId/itemId は任意） */
master.get("/item-prices", (req, res) => {
  try {
    const vendorId = req.query.vendorId ? ID.vendor(String(req.query.vendorId)) : null;
    const itemId = req.query.itemId ? ID.item(String(req.query.itemId)) : null;

    const rows = db.prepare(
      `
      SELECT
        id,
        vendor_id  AS vendorId,
        item_id    AS itemId,
        unit_price AS unitPrice,
        valid_from AS validFrom,
        valid_to   AS validTo
      FROM item_prices
      WHERE (@vendorId IS NULL OR vendor_id = @vendorId)
        AND (@itemId   IS NULL OR item_id   = @itemId)
      ORDER BY vendor_id, item_id, valid_from
      `
    ).all({ vendorId, itemId }) as ItemPriceRow[];

    res.json({ ok: true, rows });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * item_prices upsert（最小バリデーション）
 * body: { id?, vendorId, itemId, unitPrice, validFrom, validTo? }
 */
master.post("/item-prices/upsert", (req, res) => {
  try {
    const body = (req.body ?? {}) as any;

    // const id = body.id ? Number(body.id) : null;
    const vendorId = ID.vendor(body.vendorId ?? "");
    const itemId = ID.item(body.itemId ?? "");

    const unitPriceRaw = Number(body.unitPrice);
    const unitPrice = Number.isFinite(unitPriceRaw) ? unitPriceRaw : NaN;

    const validFrom = String(body.validFrom ?? "").trim();
    const validTo = toNullIfEmpty(body.validTo);

    // 必須チェック
    if (!vendorId || !itemId) {
      return res.status(400).json({ ok: false, error: "vendorId/itemId is required" });
    }
    if (!Number.isFinite(unitPrice)) {
      return res.status(400).json({ ok: false, error: "unitPrice must be a number" });
    }

    // ルール：円の整数
    if (!Number.isInteger(unitPrice) || unitPrice <= 0) {
      return res.status(400).json({ ok: false, error: "unitPrice must be integer yen (>0)" });
    }

    if (!isYmd(validFrom)) {
      return res.status(400).json({ ok: false, error: "validFrom must be YYYY-MM-DD" });
    }
    if (validTo && !isYmd(validTo)) {
      return res.status(400).json({ ok: false, error: "validTo must be YYYY-MM-DD or empty" });
    }
    if (validTo && validTo < validFrom) {
      return res.status(400).json({ ok: false, error: "validTo must be >= validFrom" });
    }

    // ★ id 未指定でも「同一 vendor/item/validFrom があれば update 扱い」に寄せる
    let id = body.id ? Number(body.id) : null;

    if (!id) {
      const found = db
        .prepare(
          `
          SELECT id FROM item_prices
          WHERE vendor_id=@vendorId AND item_id=@itemId AND valid_from=@validFrom
          `
        )
        .get({ vendorId, itemId, validFrom }) as { id: number } | undefined;

      if (found?.id) {
        id = found.id; // 以後、overlap 判定で自分を除外できる
      }
    }

    // 重複期間チェック（同 vendor/item 内で overlap 禁止）
    const existing = db.prepare(
      `
      SELECT id, valid_from AS validFrom, valid_to AS validTo
      FROM item_prices
      WHERE vendor_id=@vendorId AND item_id=@itemId
      `
    ).all({ vendorId, itemId }) as { id: number; validFrom: string; validTo: string | null }[];

    for (const r of existing) {
      if (id && r.id === id) continue;
      if (overlaps(validFrom, validTo, r.validFrom, r.validTo)) {
        return res.status(400).json({
          ok: false,
          error: `date range overlaps existing row id=${r.id} (${r.validFrom}..${r.validTo ?? "NULL"})`,
        });
      }
    }

    const tx = db.transaction(() => {
      if (id) {
        const info = db.prepare(
          `
          UPDATE item_prices
             SET vendor_id=@vendorId,
                 item_id=@itemId,
                 unit_price=@unitPrice,
                 valid_from=@validFrom,
                 valid_to=@validTo
           WHERE id=@id
          `
        ).run({ id, vendorId, itemId, unitPrice, validFrom, validTo });

        if (info.changes === 0) {
          throw new Error(`item_prices not found: id=${id}`);
        }
        return { id };
      } else {
        // 同一 vendor/item/valid_from が既にあるなら UPDATE に寄せる
        const found = db.prepare(
          `
          SELECT id FROM item_prices
           WHERE vendor_id=@vendorId AND item_id=@itemId AND valid_from=@validFrom
          `
        ).get({ vendorId, itemId, validFrom }) as { id: number } | undefined;

        if (found?.id) {
          db.prepare(
            `
            UPDATE item_prices
               SET unit_price=@unitPrice,
                   valid_to=@validTo
             WHERE id=@id
            `
          ).run({ id: found.id, unitPrice, validTo });
          return { id: found.id };
        }

        const info = db.prepare(
          `
          INSERT INTO item_prices (vendor_id, item_id, unit_price, valid_from, valid_to)
          VALUES (@vendorId, @itemId, @unitPrice, @validFrom, @validTo)
          `
        ).run({ vendorId, itemId, unitPrice, validFrom, validTo });

        return { id: Number(info.lastInsertRowid) };
      }
    });

    const r = tx();
    res.json({ ok: true, ...r });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/** 異常検出（期間重複/順序不正の検出） */
master.get("/item-prices/anomalies", (req, res) => {
  try {
    const vendorId = req.query.vendorId ? ID.vendor(String(req.query.vendorId)) : null;

    const rows = db.prepare(
      `
      SELECT vendor_id AS vendorId, item_id AS itemId, id, valid_from AS validFrom, valid_to AS validTo, unit_price AS unitPrice
      FROM item_prices
      WHERE (@vendorId IS NULL OR vendor_id=@vendorId)
      ORDER BY vendor_id, item_id, valid_from
      `
    ).all({ vendorId }) as (ItemPriceRow & { validFrom: string; validTo: string | null })[];

    // group by vendorId+itemId
    const key = (r: any) => `${r.vendorId}__${r.itemId}`;
    const groups = new Map<string, ItemPriceRow[]>();
    for (const r of rows) {
      const k = key(r);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }

    const anomalies: any[] = [];
    for (const [k, list] of groups.entries()) {
      const sorted = [...list].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
      for (let i = 0; i < sorted.length; i++) {
        const cur = sorted[i];
        if (cur.validTo && cur.validTo < cur.validFrom) {
          anomalies.push({ type: "INVALID_RANGE", ...cur });
        }
        if (i > 0) {
          const prev = sorted[i - 1];
          if (overlaps(prev.validFrom, prev.validTo, cur.validFrom, cur.validTo)) {
            anomalies.push({
              type: "OVERLAP",
              vendorId: cur.vendorId,
              itemId: cur.itemId,
              a: { id: prev.id, from: prev.validFrom, to: prev.validTo },
              b: { id: cur.id, from: cur.validFrom, to: cur.validTo },
            });
          }
        }
      }
    }

    res.json({ ok: true, count: anomalies.length, anomalies });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// === vendor_weekly_rules / store_vendor_overrides 管理（最小）====================

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function isHHMM(v: string) {
  if (!/^\d{2}:\d{2}$/.test(v)) return false;
  const [hh, mm] = v.split(":").map((n) => Number(n));
  return Number.isInteger(hh) && Number.isInteger(mm) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

function parseOrderable(v: any, allowNull: boolean) {
  if (v === undefined) return undefined; // 未指定（merge用）
  if (v === null || v === "") return allowNull ? null : 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  if (!Number.isFinite(n) || !(n === 0 || n === 1)) throw new Error("orderable must be 0/1");
  return n;
}

function parseLeadTimeDays(v: any, allowNull: boolean) {
  if (v === undefined) return undefined; // 未指定（merge用）
  if (v === null || v === "") return allowNull ? null : 1;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) throw new Error("leadTimeDays must be integer >= 0");
  return n;
}

function parseCutoffHHMM(v: any, allowNull: boolean) {
  if (v === undefined) return undefined; // 未指定（merge用）
  if (v === null || v === "") return allowNull ? null : "04:00";
  const s = String(v);
  if (!isHHMM(s)) throw new Error("cutoffHhmm must be HH:MM");
  return s;
}

function pick<T extends Record<string, any>>(obj: any, key: string): T[keyof T] | undefined {
  if (!obj) return undefined;
  return obj[key];
}

// --- vendor_weekly_rules ------------------------------------------------------

master.get("/vendor-weekly-rules", (req, res) => {
  try {
    const vendorId = req.query.vendorId ? ID.vendor(String(req.query.vendorId)) : null;

    const rows = db
      .prepare(
        `
      SELECT
        vendor_id AS vendorId,
        orderable_sun AS orderableSun, cutoff_hhmm_sun AS cutoffHhmmSun, lead_time_days_sun AS leadTimeDaysSun,
        orderable_mon AS orderableMon, cutoff_hhmm_mon AS cutoffHhmmMon, lead_time_days_mon AS leadTimeDaysMon,
        orderable_tue AS orderableTue, cutoff_hhmm_tue AS cutoffHhmmTue, lead_time_days_tue AS leadTimeDaysTue,
        orderable_wed AS orderableWed, cutoff_hhmm_wed AS cutoffHhmmWed, lead_time_days_wed AS leadTimeDaysWed,
        orderable_thu AS orderableThu, cutoff_hhmm_thu AS cutoffHhmmThu, lead_time_days_thu AS leadTimeDaysThu,
        orderable_fri AS orderableFri, cutoff_hhmm_fri AS cutoffHhmmFri, lead_time_days_fri AS leadTimeDaysFri,
        orderable_sat AS orderableSat, cutoff_hhmm_sat AS cutoffHhmmSat, lead_time_days_sat AS leadTimeDaysSat,
        updated_at AS updatedAt
      FROM vendor_weekly_rules
      WHERE (@vendorId IS NULL OR vendor_id=@vendorId)
      ORDER BY vendor_id
      `
      )
      .all({ vendorId });

    res.json({ ok: true, rows });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

master.post("/vendor-weekly-rules/upsert", (req, res) => {
  try {
    const body = (req.body ?? {}) as any;
    const vendorId = ID.vendor(body.vendorId ?? "");
    if (!vendorId) return res.status(400).json({ ok: false, error: "vendorId is required" });

    // 既存を読む（部分更新を許すため）
    const existing = db
      .prepare(`SELECT * FROM vendor_weekly_rules WHERE vendor_id=@vendorId`)
      .get({ vendorId }) as any | undefined;

    // 既存 or デフォルトでベースを作る
    const base: any = existing ?? { vendor_id: vendorId };
    for (const d of DAYS) {
      base[`orderable_${d}`] = base[`orderable_${d}`] ?? 0;
      base[`cutoff_hhmm_${d}`] = base[`cutoff_hhmm_${d}`] ?? "04:00";
      base[`lead_time_days_${d}`] = base[`lead_time_days_${d}`] ?? 1;
    }

    // body からの上書き（camelCaseで受ける）
    const map = (d: (typeof DAYS)[number]) => {
      const D = d.charAt(0).toUpperCase() + d.slice(1);
      const o = parseOrderable(pick(body, `orderable${D}`), false);
      const c = parseCutoffHHMM(pick(body, `cutoffHhmm${D}`), false);
      const l = parseLeadTimeDays(pick(body, `leadTimeDays${D}`), false);
      if (o !== undefined) base[`orderable_${d}`] = o;
      if (c !== undefined) base[`cutoff_hhmm_${d}`] = c;
      if (l !== undefined) base[`lead_time_days_${d}`] = l;
    };
    DAYS.forEach(map);

    // 最終バリデーション（ここで落とす）
    for (const d of DAYS) {
      const o = base[`orderable_${d}`];
      const c = base[`cutoff_hhmm_${d}`];
      const l = base[`lead_time_days_${d}`];
      if (!(o === 0 || o === 1)) return res.status(400).json({ ok: false, error: `orderable_${d} must be 0/1` });
      if (!isHHMM(String(c))) return res.status(400).json({ ok: false, error: `cutoff_hhmm_${d} must be HH:MM` });
      if (!Number.isInteger(l) || l < 0) return res.status(400).json({ ok: false, error: `lead_time_days_${d} must be integer >= 0` });
    }

    db.prepare(
      `
      INSERT INTO vendor_weekly_rules (
        vendor_id,
        orderable_sun, cutoff_hhmm_sun, lead_time_days_sun,
        orderable_mon, cutoff_hhmm_mon, lead_time_days_mon,
        orderable_tue, cutoff_hhmm_tue, lead_time_days_tue,
        orderable_wed, cutoff_hhmm_wed, lead_time_days_wed,
        orderable_thu, cutoff_hhmm_thu, lead_time_days_thu,
        orderable_fri, cutoff_hhmm_fri, lead_time_days_fri,
        orderable_sat, cutoff_hhmm_sat, lead_time_days_sat,
        updated_at
      ) VALUES (
        @vendor_id,
        @orderable_sun, @cutoff_hhmm_sun, @lead_time_days_sun,
        @orderable_mon, @cutoff_hhmm_mon, @lead_time_days_mon,
        @orderable_tue, @cutoff_hhmm_tue, @lead_time_days_tue,
        @orderable_wed, @cutoff_hhmm_wed, @lead_time_days_wed,
        @orderable_thu, @cutoff_hhmm_thu, @lead_time_days_thu,
        @orderable_fri, @cutoff_hhmm_fri, @lead_time_days_fri,
        @orderable_sat, @cutoff_hhmm_sat, @lead_time_days_sat,
        datetime('now')
      )
      ON CONFLICT(vendor_id) DO UPDATE SET
        orderable_sun=excluded.orderable_sun, cutoff_hhmm_sun=excluded.cutoff_hhmm_sun, lead_time_days_sun=excluded.lead_time_days_sun,
        orderable_mon=excluded.orderable_mon, cutoff_hhmm_mon=excluded.cutoff_hhmm_mon, lead_time_days_mon=excluded.lead_time_days_mon,
        orderable_tue=excluded.orderable_tue, cutoff_hhmm_tue=excluded.cutoff_hhmm_tue, lead_time_days_tue=excluded.lead_time_days_tue,
        orderable_wed=excluded.orderable_wed, cutoff_hhmm_wed=excluded.cutoff_hhmm_wed, lead_time_days_wed=excluded.lead_time_days_wed,
        orderable_thu=excluded.orderable_thu, cutoff_hhmm_thu=excluded.cutoff_hhmm_thu, lead_time_days_thu=excluded.lead_time_days_thu,
        orderable_fri=excluded.orderable_fri, cutoff_hhmm_fri=excluded.cutoff_hhmm_fri, lead_time_days_fri=excluded.lead_time_days_fri,
        orderable_sat=excluded.orderable_sat, cutoff_hhmm_sat=excluded.cutoff_hhmm_sat, lead_time_days_sat=excluded.lead_time_days_sat,
        updated_at=datetime('now')
      `
    ).run(base);

    res.json({ ok: true, vendorId });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// --- store_vendor_overrides ---------------------------------------------------

master.get("/store-vendor-overrides", (req, res) => {
  try {
    const storeId = req.query.storeId ? ID.store(String(req.query.storeId)) : null;
    const vendorId = req.query.vendorId ? ID.vendor(String(req.query.vendorId)) : null;

    const rows = db
      .prepare(
        `
      SELECT
        store_id AS storeId,
        vendor_id AS vendorId,

        orderable_sun_override AS orderableSunOverride,
        cutoff_hhmm_sun_override AS cutoffHhmmSunOverride,
        lead_time_days_sun_override AS leadTimeDaysSunOverride,

        orderable_mon_override AS orderableMonOverride,
        cutoff_hhmm_mon_override AS cutoffHhmmMonOverride,
        lead_time_days_mon_override AS leadTimeDaysMonOverride,

        orderable_tue_override AS orderableTueOverride,
        cutoff_hhmm_tue_override AS cutoffHhmmTueOverride,
        lead_time_days_tue_override AS leadTimeDaysTueOverride,

        orderable_wed_override AS orderableWedOverride,
        cutoff_hhmm_wed_override AS cutoffHhmmWedOverride,
        lead_time_days_wed_override AS leadTimeDaysWedOverride,

        orderable_thu_override AS orderableThuOverride,
        cutoff_hhmm_thu_override AS cutoffHhmmThuOverride,
        lead_time_days_thu_override AS leadTimeDaysThuOverride,

        orderable_fri_override AS orderableFriOverride,
        cutoff_hhmm_fri_override AS cutoffHhmmFriOverride,
        lead_time_days_fri_override AS leadTimeDaysFriOverride,

        orderable_sat_override AS orderableSatOverride,
        cutoff_hhmm_sat_override AS cutoffHhmmSatOverride,
        lead_time_days_sat_override AS leadTimeDaysSatOverride,

        updated_at AS updatedAt
      FROM store_vendor_overrides
      WHERE (@storeId IS NULL OR store_id=@storeId)
        AND (@vendorId IS NULL OR vendor_id=@vendorId)
      ORDER BY store_id, vendor_id
      `
      )
      .all({ storeId, vendorId });

    res.json({ ok: true, rows });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

master.post("/store-vendor-overrides/upsert", (req, res) => {
  try {
    const body = (req.body ?? {}) as any;
    const storeId = ID.store(body.storeId ?? "");
    const vendorId = ID.vendor(body.vendorId ?? "");
    if (!storeId || !vendorId) return res.status(400).json({ ok: false, error: "storeId/vendorId is required" });

    // 既存読み（部分更新）
    const existing = db
      .prepare(`SELECT * FROM store_vendor_overrides WHERE store_id=@storeId AND vendor_id=@vendorId`)
      .get({ storeId, vendorId }) as any | undefined;

    const base: any = existing ?? { store_id: storeId, vendor_id: vendorId };

    const setDay = (d: (typeof DAYS)[number]) => {
      const D = d.charAt(0).toUpperCase() + d.slice(1);

      const o = parseOrderable(pick(body, `orderable${D}Override`), true);
      const c = parseCutoffHHMM(pick(body, `cutoffHhmm${D}Override`), true);
      const l = parseLeadTimeDays(pick(body, `leadTimeDays${D}Override`), true);

      if (o !== undefined) base[`orderable_${d}_override`] = o;
      if (c !== undefined) base[`cutoff_hhmm_${d}_override`] = c;
      if (l !== undefined) base[`lead_time_days_${d}_override`] = l;

      // 指定された値だけ個別に validate（nullはOK）
      const oo = base[`orderable_${d}_override`];
      const cc = base[`cutoff_hhmm_${d}_override`];
      const ll = base[`lead_time_days_${d}_override`];
      if (!(oo === null || oo === 0 || oo === 1)) throw new Error(`orderable_${d}_override must be null/0/1`);
      if (!(cc === null || isHHMM(String(cc)))) throw new Error(`cutoff_hhmm_${d}_override must be null or HH:MM`);
      if (!(ll === null || (Number.isInteger(ll) && ll >= 0))) throw new Error(`lead_time_days_${d}_override must be null or integer >= 0`);
    };

    DAYS.forEach(setDay);

    db.prepare(
      `
      INSERT INTO store_vendor_overrides (
        store_id, vendor_id,

        orderable_sun_override, cutoff_hhmm_sun_override, lead_time_days_sun_override,
        orderable_mon_override, cutoff_hhmm_mon_override, lead_time_days_mon_override,
        orderable_tue_override, cutoff_hhmm_tue_override, lead_time_days_tue_override,
        orderable_wed_override, cutoff_hhmm_wed_override, lead_time_days_wed_override,
        orderable_thu_override, cutoff_hhmm_thu_override, lead_time_days_thu_override,
        orderable_fri_override, cutoff_hhmm_fri_override, lead_time_days_fri_override,
        orderable_sat_override, cutoff_hhmm_sat_override, lead_time_days_sat_override,

        updated_at
      ) VALUES (
        @store_id, @vendor_id,

        @orderable_sun_override, @cutoff_hhmm_sun_override, @lead_time_days_sun_override,
        @orderable_mon_override, @cutoff_hhmm_mon_override, @lead_time_days_mon_override,
        @orderable_tue_override, @cutoff_hhmm_tue_override, @lead_time_days_tue_override,
        @orderable_wed_override, @cutoff_hhmm_wed_override, @lead_time_days_wed_override,
        @orderable_thu_override, @cutoff_hhmm_thu_override, @lead_time_days_thu_override,
        @orderable_fri_override, @cutoff_hhmm_fri_override, @lead_time_days_fri_override,
        @orderable_sat_override, @cutoff_hhmm_sat_override, @lead_time_days_sat_override,

        datetime('now')
      )
      ON CONFLICT(store_id, vendor_id) DO UPDATE SET
        orderable_sun_override=excluded.orderable_sun_override,
        cutoff_hhmm_sun_override=excluded.cutoff_hhmm_sun_override,
        lead_time_days_sun_override=excluded.lead_time_days_sun_override,

        orderable_mon_override=excluded.orderable_mon_override,
        cutoff_hhmm_mon_override=excluded.cutoff_hhmm_mon_override,
        lead_time_days_mon_override=excluded.lead_time_days_mon_override,

        orderable_tue_override=excluded.orderable_tue_override,
        cutoff_hhmm_tue_override=excluded.cutoff_hhmm_tue_override,
        lead_time_days_tue_override=excluded.lead_time_days_tue_override,

        orderable_wed_override=excluded.orderable_wed_override,
        cutoff_hhmm_wed_override=excluded.cutoff_hhmm_wed_override,
        lead_time_days_wed_override=excluded.lead_time_days_wed_override,

        orderable_thu_override=excluded.orderable_thu_override,
        cutoff_hhmm_thu_override=excluded.cutoff_hhmm_thu_override,
        lead_time_days_thu_override=excluded.lead_time_days_thu_override,

        orderable_fri_override=excluded.orderable_fri_override,
        cutoff_hhmm_fri_override=excluded.cutoff_hhmm_fri_override,
        lead_time_days_fri_override=excluded.lead_time_days_fri_override,

        orderable_sat_override=excluded.orderable_sat_override,
        cutoff_hhmm_sat_override=excluded.cutoff_hhmm_sat_override,
        lead_time_days_sat_override=excluded.lead_time_days_sat_override,

        updated_at=datetime('now')
      `
    ).run(base);

    res.json({ ok: true, storeId, vendorId });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

