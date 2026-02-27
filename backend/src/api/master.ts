import { Router } from 'express';
import { db } from '../db';
import { ID } from '../lib/id';

export const master = Router();


type CsvDateStyle = "iso" | "slash";

function csvDateStyleFromQuery(v: unknown): CsvDateStyle {
  return v === "slash" ? "slash" : "iso"; // デフォルト iso
}

function formatDateForCsv(s: string | null | undefined, style: CsvDateStyle): string {
  if (!s) return "";
  const str = String(s).trim();
  // DBは YYYY-MM-DD 前提（入力バリデーションもそうなってる）
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return str;
  const [, y, mo, d] = m;
  return style === "iso" ? `${y}-${mo}-${d}` : `${y}/${mo}/${d}`; // Excel向け
}

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

/** 店舗一覧（VendorEdit の納品先モーダル／マスタメンテでも使用）
 *  query: includeInactive=1 で非稼働も含める
 */
master.get('/stores', (req, res) => {
  try {
    const includeInactive = String(req.query.includeInactive ?? "") === "1";

    const rows = db.prepare(`
      SELECT
        id,
        name,
        is_active AS isActive
      FROM stores
      ${includeInactive ? "" : "WHERE is_active = 1"}
      ORDER BY id
    `).all();

    // ★ 配列そのものを返す（旧 server.ts と同じ）
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

/** ベンダ登録/更新（マスタメンテ用） */
master.post('/vendors/upsert', (req, res) => {
  try {
    const idRaw = String(req.body?.id ?? "");
    const nameRaw = String(req.body?.name ?? "").trim();

    const id = ID.vendor(idRaw);
    if (!id || id.length !== 6) {
      return res.status(400).json({ ok: false, error: "invalid vendor id" });
    }
    if (!nameRaw) {
      return res.status(400).json({ ok: false, error: "name is required" });
    }

    db.prepare(`
      INSERT INTO vendors (id, name)
      VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name
    `).run(id, nameRaw);

    res.json({ ok: true, id });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/** 店舗登録/更新（マスタメンテ用） */
master.post('/stores/upsert', (req, res) => {
  try {
    const idRaw = String(req.body?.id ?? "");
    const nameRaw = String(req.body?.name ?? "").trim();
    const isActiveRaw = req.body?.isActive;

    const id = ID.store(idRaw);
    if (!id || id.length !== 4) {
      return res.status(400).json({ ok: false, error: "invalid store id" });
    }
    if (!nameRaw) {
      return res.status(400).json({ ok: false, error: "name is required" });
    }

    const isActive: 0 | 1 = (Number(isActiveRaw) === 0 ? 0 : 1);
    const code = String(req.body?.code ?? "").trim() || id; // stores.code が必須なので id をデフォルトに

    db.prepare(`
      INSERT INTO stores (id, code, name, is_active)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code,
        name = excluded.name,
        is_active = excluded.is_active
    `).run(id, code, nameRaw, isActive);

    res.json({ ok: true, id });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

master.get("/vendors.csv", (_req, res) => {
  const rows = db.prepare(`SELECT id, name FROM vendors ORDER BY id`).all() as any[];
  const csv = ["id,name", ...rows.map(r => `${r.id},${(r.name ?? "").replaceAll('"','""')}`)].join("\n");
  sendCsv(res, "vendors.csv", csv);
});

master.get("/stores.csv", (req, res) => {
  const includeInactive = String(req.query.includeInactive ?? "") === "1";
  const rows = db.prepare(`
    SELECT id, code, name, is_active AS isActive
    FROM stores
    ${includeInactive ? "" : "WHERE is_active = 1"}
    ORDER BY id
  `).all() as any[];
  const csv = ["id,code,name,isActive", ...rows.map(r => `${r.id},${r.code},${(r.name ?? "").replaceAll('"','""')},${r.isActive}`)].join("\n");
  sendCsv(res, "stores.csv", csv);
});

/** 全品目（フォールバック用＋マスタメンテ用）
 *  query: includeInactive=1 で非稼働も含める
 */
master.get("/items", (req, res) => {
  try {
    const includeInactive = String(req.query.includeInactive ?? "") === "1";

    const rows = db
      .prepare(
        `
        SELECT
          id,
          name,
          unit,
          spec,
          temp_zone  AS tempZone,
          is_active  AS isActive,
          stock_unit AS stockUnit,
          stock_conv AS stockConv
        FROM items
        ${includeInactive ? "" : "WHERE is_active = 1"}
        ORDER BY id
        `
      )
      .all();

    // 既存互換：{ items: [...] } で返す（今のフロントを壊さない）
    res.json({ items: rows });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: String((e as any)?.message ?? e) });
  }
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

/** item_prices 一覧（vendorId/itemId は任意 / asOf 指定時は“時点の現行”のみ） */
master.get("/item-prices", (req, res) => {
  try {
    const vendorId = req.query.vendorId ? ID.vendor(String(req.query.vendorId)) : null;
    const itemId = req.query.itemId ? ID.item(String(req.query.itemId)) : null;

    const asOf = req.query.asOf ? String(req.query.asOf).trim() : null;
    if (asOf && !isYmd(asOf)) {
      return res.status(400).json({ ok: false, error: "asOf must be YYYY-MM-DD" });
    }

    const rows = db
      .prepare(
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
          AND (
            @asOf IS NULL OR (
              valid_from <= @asOf AND (valid_to IS NULL OR valid_to >= @asOf)
            )
          )
        ORDER BY vendor_id, item_id, valid_from
        `
      )
      .all({ vendorId, itemId, asOf }) as ItemPriceRow[];

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

    const vendorId = ID.vendor(String(body.vendorId ?? ""));
    const itemId = ID.item(String(body.itemId ?? ""));
    const unitPrice = Number(body.unitPrice);

    const validFrom = String(body.validFrom ?? "").trim();
    const validTo = String(body.validTo ?? "").trim() || null;

    // 必須チェック
    if (!vendorId || !itemId) {
      return res.status(400).json({ ok: false, error: "vendorId/itemId is required" });
    }
    if (!Number.isFinite(unitPrice)) {
      return res.status(400).json({ ok: false, error: "unitPrice must be a number" });
    }
    // ルール：円の整数（既存仕様のまま）
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

    // ★ id 未指定でも「同一 vendor/item/validFrom があれば update 扱い」に寄せる（既存仕様）
    let id = body.id ? Number(body.id) : null;
    if (id && (!Number.isFinite(id) || id <= 0)) {
      return res.status(400).json({ ok: false, error: "id must be a positive number" });
    }

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

    // existing（同 vendor/item）
    const existing = db
      .prepare(
        `
        SELECT id, valid_from AS validFrom, valid_to AS validTo
        FROM item_prices
        WHERE vendor_id=@vendorId AND item_id=@itemId
        `
      )
      .all({ vendorId, itemId }) as { id: number; validFrom: string; validTo: string | null }[];

    // ========== ここが追加：insert 時にだけ「直前行を自動で閉じる」 ==========
    const isInsertNew = !id; // 同一 validFrom の update に寄せた場合は id が入るので insert 扱いにならない

    // 直前候補：valid_from < 新validFrom の中で最大
    const prev = isInsertNew
      ? existing
          .filter((r) => r.validFrom < validFrom)
          .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]
      : undefined;

    // overlap 行を列挙（insert 時は “prev だけ” なら自動クローズで吸収する）
    const overlapsWith = existing.filter((r) => {
      if (id && r.id === id) return false;
      return overlaps(validFrom, validTo, r.validFrom, r.validTo);
    });

    let autoClosePrevId: number | null = null;

    if (overlapsWith.length > 0) {
      if (
        isInsertNew &&
        prev &&
        overlapsWith.length === 1 &&
        overlapsWith[0].id === prev.id &&
        prev.validFrom < validFrom
      ) {
        // prev が新validFromを覆っている（典型：prev.validTo が NULL）ので、prev を validFrom-1日 で閉じる
        autoClosePrevId = prev.id;
        // ※ close 後に他の overlap が残るケースは、overlapsWith が 1件以外ならここで弾ける
      } else {
        // 従来どおりエラー
        const r = overlapsWith[0];
        return res.status(400).json({
          ok: false,
          error: `date range overlaps existing row id=${r.id} (${r.validFrom}.${r.validTo ?? "NULL"})`,
        });
      }
    }
    // ========== 追加ここまで ==========

    const tx = db.transaction(() => {
      if (id) {
        const info = db
          .prepare(
            `
            UPDATE item_prices
               SET vendor_id=@vendorId,
                   item_id=@itemId,
                   unit_price=@unitPrice,
                   valid_from=@validFrom,
                   valid_to=@validTo
             WHERE id=@id
            `
          )
          .run({ id, vendorId, itemId, unitPrice, validFrom, validTo });

        if (info.changes === 0) {
          throw new Error(`item_prices not found: id=${id}`);
        }
        return { id, autoClosed: null as null | { id: number; validTo: string } };
      }

      // insert のとき：必要なら prev を閉じる
      let autoClosed: null | { id: number; validTo: string } = null;

      if (autoClosePrevId) {
        // DB側で date(validFrom,'-1 day') を使う（タイムゾーン事故を避ける）
        db.prepare(
          `
          UPDATE item_prices
             SET valid_to = date(@validFrom, '-1 day')
           WHERE id=@id
          `
        ).run({ id: autoClosePrevId, validFrom });

        // 返却用に計算（表示だけ）
        const d = new Date(`${validFrom}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 1);
        autoClosed = { id: autoClosePrevId, validTo: d.toISOString().slice(0, 10) };
      }

      const info = db
        .prepare(
          `
          INSERT INTO item_prices (vendor_id, item_id, unit_price, valid_from, valid_to)
          VALUES (@vendorId, @itemId, @unitPrice, @validFrom, @validTo)
          `
        )
        .run({ vendorId, itemId, unitPrice, validFrom, validTo });

      return { id: Number(info.lastInsertRowid), autoClosed };
    });

    const r = tx();
    return res.json({ ok: true, ...r });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
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

// === vendor_items（ベンダー×品目：期間管理）====================================

type VendorItemRow = {
  id: number;
  vendorId: string;
  itemId: string;
  validFrom: string;
  validTo: string | null;
};

function isYmd2(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// CSV import 用：ゆるい日付（YYYY-MM-DD / YYYY/M/D / YYYY/MM/DD）→ YYYY-MM-DD
function normalizeYmdLoose(s: unknown): string | null {
  const raw = String(s ?? "").trim();
  if (!raw) return null;

  // すでに YYYY-MM-DD
  if (isYmd2(raw)) return raw;

  // YYYY-M-D / YYYY/MM/DD など
  const m = raw.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (!m) return null;

  const y = m[1];
  const mm = m[2].padStart(2, "0");
  const dd = m[3].padStart(2, "0");
  const out = `${y}-${mm}-${dd}`;
  return isYmd2(out) ? out : null;
}

type ImportErr = { line: number; field?: string; message: string; value?: string };

// カンマCSV/TSVのどちらも最低限読める（ExcelでコピペしたTSVにも耐える）
function detectDelim(headerLine: string): "," | "\t" {
  const comma = (headerLine.match(/,/g) ?? []).length;
  const tab = (headerLine.match(/\t/g) ?? []).length;
  return tab > comma ? "\t" : ",";
}

function parseDelimitedLine(line: string, delim: "," | "\t"): string[] {
  // 簡易CSV（クォート対応）
  const out: string[] = [];
  let cur = "";
  let inQ = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQ = true;
      continue;
    }

    if (ch === delim) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseTable(text: string): { header: string[]; rows: string[][] } {
  const src = String(text ?? "").replace(/^\uFEFF/, ""); // BOM除去
  const lines = src.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };

  const delim = detectDelim(lines[0]);
  const header = parseDelimitedLine(lines[0], delim).map((h) => h.trim());
  const rows = lines.slice(1).map((l) => parseDelimitedLine(l, delim));
  return { header, rows };
}

function findCol(header: string[], names: string[]): number {
  const lower = header.map((h) => h.toLowerCase());
  for (const n of names) {
    const idx = lower.indexOf(n.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

/** vendor_items 一覧（vendorId/itemId/asOf は任意） */
master.get("/vendor-items", (req, res) => {
  try {
    const vendorId = req.query.vendorId ? ID.vendor(String(req.query.vendorId)) : null;
    const itemId = req.query.itemId ? ID.item(String(req.query.itemId)) : null;
    const asOfRaw = req.query.asOf ? String(req.query.asOf).trim() : null;
    const asOf = asOfRaw && isYmd2(asOfRaw) ? asOfRaw : null;

    const rows = db
      .prepare(
        `
        SELECT
          id,
          vendor_id  AS vendorId,
          item_id    AS itemId,
          valid_from AS validFrom,
          valid_to   AS validTo
        FROM vendor_items
        WHERE (@vendorId IS NULL OR vendor_id=@vendorId)
          AND (@itemId   IS NULL OR item_id=@itemId)
          AND valid_from <= COALESCE(@asOf, date('now','localtime'))
          AND (valid_to IS NULL OR valid_to >= COALESCE(@asOf, date('now','localtime')))
        ORDER BY vendor_id, item_id, valid_from
        `
      )
      .all({ vendorId, itemId, asOf }) as VendorItemRow[];

    res.json({ ok: true, rows });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: String((e as { message?: unknown })?.message ?? e) });
  }
});

/**
 * vendor_items 現行入替（replace-current）
 * body: { vendorId, validFrom, itemIds: string[] }
 *
 * - 現行（valid_to IS NULL）を validFrom の前日で閉じる
 * - validFrom 以降の「未閉じ」データ（未来分など）があれば削除して入替
 * - 新しい現行セットを validFrom で INSERT
 */
master.post("/vendor-items/replace-current", (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const vendorId = ID.vendor(String(body.vendorId ?? ""));
    const validFrom = String(body.validFrom ?? "").trim();
    const itemIdsRaw = Array.isArray(body.itemIds) ? body.itemIds : [];

    if (!vendorId) return res.status(400).json({ ok: false, error: "vendorId is required" });
    if (!isYmd2(validFrom)) return res.status(400).json({ ok: false, error: "validFrom must be YYYY-MM-DD" });

    const itemIds = itemIdsRaw
      .map((x) => ID.item(String(x ?? "")))
      .filter((x) => !!x);

    const uniq = Array.from(new Set(itemIds));
    if (uniq.length === 0) {
      return res.status(400).json({ ok: false, error: "itemIds is required (non-empty)" });
    }

    // 存在チェック：vendor
    const v = db.prepare(`SELECT 1 FROM vendors WHERE id=?`).get(vendorId);
    if (!v) return res.status(400).json({ ok: false, error: `vendor not found: ${vendorId}` });

    // 存在チェック：items（IN でまとめて）
    const placeholders = uniq.map(() => "?").join(",");
    const foundItems = db
      .prepare(`SELECT id FROM items WHERE id IN (${placeholders})`)
      .all(...uniq) as { id: string }[];

    if (foundItems.length !== uniq.length) {
      const foundSet = new Set(foundItems.map((r) => r.id));
      const missing = uniq.filter((id) => !foundSet.has(id));
      return res.status(400).json({ ok: false, error: `items not found: ${missing.join(",")}` });
    }

    // ★ここから transaction
    const tx = db.transaction(() => {
      // 現行セット（asOf=validFrom）を取る
      const cur = db.prepare(
        `
        SELECT item_id AS itemId
        FROM vendor_items
        WHERE vendor_id=@vendorId
          AND valid_from <= @asOf
          AND (valid_to IS NULL OR valid_to >= @asOf)
        ORDER BY item_id
        `
      ).all({ vendorId, asOf: validFrom }) as { itemId: string }[];

      const curSet = new Set(cur.map((r) => r.itemId));
      const nextSet = new Set(uniq);

      const same =
        curSet.size === nextSet.size &&
        uniq.every((id) => curSet.has(id));

      // validFrom 以降の未来行（同日含む）
      const future = db.prepare(
        `
        SELECT item_id AS itemId, valid_from AS validFrom
        FROM vendor_items
        WHERE vendor_id=@vendorId
          AND valid_from >= @validFrom
        `
      ).all({ vendorId, validFrom }) as { itemId: string; validFrom: string }[];

      const futureIsOnlySameValidFrom =
        future.length === uniq.length &&
        future.every((r) => r.validFrom === validFrom && nextSet.has(r.itemId));

      if (same && futureIsOnlySameValidFrom) {
        return { ok: true as const, vendorId, validFrom, count: uniq.length, noOp: true as const };
      }

      // 1) validFrom 以降は全削除（過去日に backdate しても重複しない）
      db.prepare(
        `
        DELETE FROM vendor_items
         WHERE vendor_id=@vendorId
           AND valid_from >= @validFrom
        `
      ).run({ vendorId, validFrom });

      // 2) validFrom にかかる行を閉じる（validFrom-1日）
      db.prepare(
        `
        UPDATE vendor_items
           SET valid_to = date(@validFrom, '-1 day')
         WHERE vendor_id=@vendorId
           AND valid_from < @validFrom
           AND (valid_to IS NULL OR valid_to >= @validFrom)
        `
      ).run({ vendorId, validFrom });

      // 3) 新しい現行セットを INSERT
      const ins = db.prepare(
        `
        INSERT INTO vendor_items (vendor_id, item_id, valid_from, valid_to)
        VALUES (@vendorId, @itemId, @validFrom, NULL)
        `
      );

      for (const itemId of uniq) {
        ins.run({ vendorId, itemId, validFrom });
      }

      return { ok: true as const, vendorId, validFrom, count: uniq.length, noOp: false as const };
    });

    const r = tx();
    return res.json(r);
  } catch (e: unknown) {
    return res.status(500).json({ ok: false, error: String((e as { message?: unknown })?.message ?? e) });
  }
});

// POST /master/vendor-items/import
// body: { csv: string, dryRun?: boolean }
//
// 想定CSV： vendorId, itemId, validFrom（vendorName/itemName/validTo はあっても無視）
// ※ vendorId ごとに validFrom は 1種類だけ（複数ある場合は事故防止でエラー）
master.post("/vendor-items/import", (req, res) => {
  try {
    const body = (req.body ?? {}) as any;
    const csv = String(body.csv ?? "");
    const dryRun = !!body.dryRun;

    // ★ 追加：UI側の validFrom を優先（CSV列 validFrom は無視できる）
    const overrideValidFromRaw = String(body.validFrom ?? "").trim();
    const overrideValidFrom = overrideValidFromRaw ? normalizeYmdLoose(overrideValidFromRaw) : null;
    if (overrideValidFromRaw && !overrideValidFrom) {
      return res.status(400).json({ ok: false, error: "validFrom must be YYYY-MM-DD (or YYYY/MM/DD)" });
    }

    if (!csv.trim()) {
      return res.status(400).json({ ok: false, error: "csv is required" });
    }

    const t = parseTable(csv);
    const h = t.header;

    const cVendorId = findCol(h, ["vendorid", "vendor_id"]);
    const cItemId = findCol(h, ["itemid", "item_id"]);
    const cValidFrom = findCol(h, ["validfrom", "valid_from"]);

    if (cVendorId < 0 || cItemId < 0 || cValidFrom < 0) {
      return res.status(400).json({
        ok: false,
        error: "columns required: vendorId, itemId, validFrom",
        header: h,
      });
    }

    const errors: ImportErr[] = [];
    let dataRows = 0;

    // vendorId|validFrom => Set(itemId)
    const groups = new Map<string, { vendorId: string; validFrom: string; itemIds: Set<string> }>();
    const validFromByVendor = new Map<string, Set<string>>();

    for (let i = 0; i < t.rows.length; i++) {
      const lineNo = i + 2; // 1:header, 2.. data
      const r = t.rows[i];

      // 空行っぽいのはスキップ
      if (r.every((x) => String(x ?? "").trim() === "")) continue;

      dataRows++;

      const vendorId = ID.vendor(String(r[cVendorId] ?? ""));
      const itemId = ID.item(String(r[cItemId] ?? ""));

      // ★ 置換：override があればそれを使う
      const validFrom = overrideValidFrom ?? normalizeYmdLoose(r[cValidFrom]);

      if (!vendorId) errors.push({ line: lineNo, field: "vendorId", message: "invalid", value: String(r[cVendorId] ?? "") });
      if (!itemId) errors.push({ line: lineNo, field: "itemId", message: "invalid", value: String(r[cItemId] ?? "") });
      if (!validFrom) errors.push({ line: lineNo, field: "validFrom", message: "invalid date", value: String(r[cValidFrom] ?? "") });

      if (!vendorId || !itemId || !validFrom) continue;

      if (!validFromByVendor.has(vendorId)) validFromByVendor.set(vendorId, new Set());
      validFromByVendor.get(vendorId)!.add(validFrom);

      const key = `${vendorId}|${validFrom}`;
      if (!groups.has(key)) groups.set(key, { vendorId, validFrom, itemIds: new Set() });
      groups.get(key)!.itemIds.add(itemId);
    }

    // ★ 修正：事故防止（vendor単位で validFrom が複数）は override が無い時だけチェック
    if (!overrideValidFrom) {
      for (const [vendorId, s] of validFromByVendor.entries()) {
        if (s.size > 1) {
          errors.push({
            line: 1,
            field: "validFrom",
            message: `multiple validFrom for vendor ${vendorId}. split file by vendor/validFrom (this import is for "current set")`,
            value: Array.from(s).sort().join(","),
          });
        }
      }
    }

    // DB存在チェック（errorsが増えすぎないよう、基本はここでまとめて）
    if (errors.length === 0) {
      const vendorIds = Array.from(new Set(Array.from(groups.values()).map((g) => g.vendorId)));
      if (vendorIds.length > 0) {
        const ph = vendorIds.map(() => "?").join(",");
        const found = db.prepare(`SELECT id FROM vendors WHERE id IN (${ph})`).all(...vendorIds) as { id: string }[];
        const foundSet = new Set(found.map((x) => x.id));
        const missing = vendorIds.filter((id) => !foundSet.has(id));
        if (missing.length) {
          errors.push({ line: 1, field: "vendorId", message: `vendor not found: ${missing.join(",")}` });
        }
      }

      const itemIds = Array.from(new Set(Array.from(groups.values()).flatMap((g) => Array.from(g.itemIds.values()))));
      if (itemIds.length > 0) {
        const ph2 = itemIds.map(() => "?").join(",");
        const found2 = db.prepare(`SELECT id FROM items WHERE id IN (${ph2})`).all(...itemIds) as { id: string }[];
        const foundSet2 = new Set(found2.map((x) => x.id));
        const missing2 = itemIds.filter((id) => !foundSet2.has(id));
        if (missing2.length) {
          errors.push({ line: 1, field: "itemId", message: `item not found: ${missing2.join(",")}` });
        }
      }
    }

    // dryRun or errors
    if (dryRun || errors.length > 0) {
      return res.json({
        ok: true,
        dryRun: true,
        rows: dataRows,
        groups: groups.size,
        appliedGroups: 0,
        noOpGroups: 0,
        errors,
      });
    }

    // apply
    const ordered = Array.from(groups.values()).sort((a, b) => {
      if (a.vendorId !== b.vendorId) return a.vendorId.localeCompare(b.vendorId);
      return a.validFrom.localeCompare(b.validFrom);
    });

    const tx = db.transaction(() => {
      let appliedGroups = 0;
      let noOpGroups = 0;

      const qCur = db.prepare(`
        SELECT item_id AS itemId
        FROM vendor_items
        WHERE vendor_id=@vendorId
          AND valid_from <= @asOf
          AND (valid_to IS NULL OR valid_to >= @asOf)
        ORDER BY item_id
      `);

      const qFuture = db.prepare(`
        SELECT item_id AS itemId, valid_from AS validFrom
        FROM vendor_items
        WHERE vendor_id=@vendorId
          AND valid_from >= @validFrom
      `);

      const delFuture = db.prepare(`
        DELETE FROM vendor_items
         WHERE vendor_id=@vendorId
           AND valid_from >= @validFrom
      `);

      const closeCover = db.prepare(`
        UPDATE vendor_items
           SET valid_to = date(@validFrom, '-1 day')
         WHERE vendor_id=@vendorId
           AND valid_from < @validFrom
           AND (valid_to IS NULL OR valid_to >= @validFrom)
      `);

      const ins = db.prepare(`
        INSERT INTO vendor_items (vendor_id, item_id, valid_from, valid_to)
        VALUES (@vendorId, @itemId, @validFrom, NULL)
      `);

      for (const g of ordered) {
        const vendorId = g.vendorId;
        const validFrom = g.validFrom;
        const itemIds = Array.from(g.itemIds.values()).sort();

        // no-op判定（同じセット & 未来に同日セットしか無いなら何もしない）
        const cur = qCur.all({ vendorId, asOf: validFrom }) as { itemId: string }[];
        const curSet = new Set(cur.map((r) => r.itemId));
        const nextSet = new Set(itemIds);

        const same = curSet.size === nextSet.size && itemIds.every((id) => curSet.has(id));

        const future = qFuture.all({ vendorId, validFrom }) as { itemId: string; validFrom: string }[];
        const futureIsOnlySameValidFrom =
          future.length === itemIds.length &&
          future.every((r) => r.validFrom === validFrom && nextSet.has(r.itemId));

        if (same && futureIsOnlySameValidFrom) {
          noOpGroups++;
          continue;
        }

        delFuture.run({ vendorId, validFrom });
        closeCover.run({ vendorId, validFrom });

        for (const itemId of itemIds) {
          ins.run({ vendorId, itemId, validFrom });
        }

        appliedGroups++;
      }

      return { appliedGroups, noOpGroups };
    });

    const r = tx();
    return res.json({
      ok: true,
      dryRun: false,
      rows: dataRows,
      groups: groups.size,
      appliedGroups: r.appliedGroups,
      noOpGroups: r.noOpGroups,
      errors: [],
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// --- 追加：vendor_items 差分更新（toggle） ---------------------------

type VendorItemsToggleChange = { itemId: string; enabled: boolean };

function parseEnabled(v: unknown): boolean | null {
  if (v === true || v === 1 || v === "1" || v === "true") return true;
  if (v === false || v === 0 || v === "0" || v === "false" || v == null || v === "") return false;
  return null;
}

/**
 * vendor_items 差分更新（toggle）
 * body: { vendorId, validFrom, changes: [{ itemId, enabled }] }
 *
 * - 対象 item のみ、validFrom 以降を整理して ON/OFF を反映
 * - 既に同じ状態なら noOp（DB増えない）
 */
master.post("/vendor-items/toggle", (req, res) => {
  try {
    const body = (req.body ?? {}) as any;

    const vendorId = ID.vendor(String(body.vendorId ?? ""));
    const validFrom = String(body.validFrom ?? "").trim();
    const changesRaw = Array.isArray(body.changes) ? body.changes : [];

    if (!vendorId) return res.status(400).json({ ok: false, error: "vendorId is required" });
    if (!isYmd2(validFrom)) return res.status(400).json({ ok: false, error: "validFrom must be YYYY-MM-DD" });

    const changes: VendorItemsToggleChange[] = changesRaw.map((c: any) => {
      const itemId = ID.item(String(c?.itemId ?? ""));
      const enabled = parseEnabled(c?.enabled);
      if (!itemId) throw new Error("changes.itemId is invalid");
      if (enabled === null) throw new Error("changes.enabled must be boolean");
      return { itemId, enabled };
    });

    // 重複（同一 itemId）は最後を優先
    const lastByItem = new Map<string, boolean>();
    for (const c of changes) lastByItem.set(c.itemId, c.enabled);
    const uniqChanges = Array.from(lastByItem.entries()).map(([itemId, enabled]) => ({ itemId, enabled }));

    if (uniqChanges.length === 0) {
      return res.json({ ok: true as const, vendorId, validFrom, requested: 0, applied: 0, noOp: true as const });
    }

    // 存在チェック：vendor
    const v = db.prepare(`SELECT 1 FROM vendors WHERE id=?`).get(vendorId);
    if (!v) return res.status(400).json({ ok: false, error: `vendor not found: ${vendorId}` });

    // 存在チェック：items（まとめて）
    const itemIds = uniqChanges.map((c) => c.itemId);
    const placeholders = itemIds.map(() => "?").join(",");
    const found = db.prepare(`SELECT id FROM items WHERE id IN (${placeholders})`).all(...itemIds) as { id: string }[];
    if (found.length !== itemIds.length) {
      const foundSet = new Set(found.map((r) => r.id));
      const missing = itemIds.filter((id) => !foundSet.has(id));
      return res.status(400).json({ ok: false, error: `items not found: ${missing.join(",")}` });
    }

    const tx = db.transaction(() => {
      const existsAt = db.prepare(
        `
        SELECT 1
        FROM vendor_items
        WHERE vendor_id=@vendorId
          AND item_id=@itemId
          AND valid_from <= @asOf
          AND (valid_to IS NULL OR valid_to >= @asOf)
        LIMIT 1
        `
      );

      const delFuture = db.prepare(
        `
        DELETE FROM vendor_items
        WHERE vendor_id=@vendorId
          AND item_id=@itemId
          AND valid_from >= @validFrom
        `
      );

      const closeCover = db.prepare(
        `
        UPDATE vendor_items
           SET valid_to = date(@validFrom, '-1 day')
         WHERE vendor_id=@vendorId
           AND item_id=@itemId
           AND valid_from < @validFrom
           AND (valid_to IS NULL OR valid_to >= @validFrom)
        `
      );

      const ins = db.prepare(
        `
        INSERT INTO vendor_items (vendor_id, item_id, valid_from, valid_to)
        VALUES (@vendorId, @itemId, @validFrom, NULL)
        `
      );

      let applied = 0;

      for (const c of uniqChanges) {
        const curOn = !!existsAt.get({ vendorId, itemId: c.itemId, asOf: validFrom });

        // すでに同じ状態なら何もしない（未来計画も触らない）
        if (curOn === c.enabled) continue;

        delFuture.run({ vendorId, itemId: c.itemId, validFrom });
        closeCover.run({ vendorId, itemId: c.itemId, validFrom });
        if (c.enabled) ins.run({ vendorId, itemId: c.itemId, validFrom });

        applied++;
      }

      return {
        ok: true as const,
        vendorId,
        validFrom,
        requested: uniqChanges.length,
        applied,
        noOp: applied === 0,
      };
    });

    return res.json(tx());
  } catch (e: unknown) {
    return res.status(500).json({ ok: false, error: String((e as { message?: unknown })?.message ?? e) });
  }
});

/** vendor_items CSV */
master.get("/vendor-items.csv", (req, res) => {
  try {
    const vendorId = req.query.vendorId ? ID.vendor(String(req.query.vendorId)) : null;

    // asOf は YYYY-MM-DD のみ受け付け（UIもこの形式想定）
    const asOfRaw = String(req.query.asOf ?? "").trim();
    const asOf = asOfRaw ? asOfRaw : null;
    if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      return res.status(400).json({ ok: false, error: "asOf must be YYYY-MM-DD" });
    }

    const rows = db
      .prepare(
        `
        SELECT
          vi.vendor_id  AS vendorId,
          v.name        AS vendorName,
          vi.item_id    AS itemId,
          i.name        AS itemName,
          vi.valid_from AS validFrom,
          vi.valid_to   AS validTo
        FROM vendor_items vi
        LEFT JOIN vendors v ON v.id = vi.vendor_id
        LEFT JOIN items   i ON i.id = vi.item_id
        WHERE (@vendorId IS NULL OR vi.vendor_id=@vendorId)
          AND (
            @asOf IS NULL
            OR (vi.valid_from <= @asOf AND (vi.valid_to IS NULL OR vi.valid_to >= @asOf))
          )
        ORDER BY vi.vendor_id, vi.item_id, vi.valid_from
        `
      )
      .all({ vendorId, asOf }) as {
        vendorId: string;
        vendorName: string | null;
        itemId: string;
        itemName: string | null;
        validFrom: string;
        validTo: string | null;
      }[];

    const dateStyle = csvDateStyleFromQuery(req.query.dateStyle);
    const lines: unknown[][] = [["vendorId", "vendorName", "itemId", "itemName", "validFrom", "validTo"]];
    for (const r of rows) {
      lines.push([
        r.vendorId ?? "",
        r.vendorName ?? "",
        r.itemId ?? "",
        r.itemName ?? "",
        formatDateForCsv(r.validFrom ?? "", dateStyle),
        formatDateForCsv(r.validTo ?? "", dateStyle),
      ]);
    }

    const csv = lines.map((row) => row.map((x) => JSON.stringify(String(x ?? ""))).join(",")).join("\n");

    // ファイル名に asOf を入れて判別しやすく
    const nameParts = [
      "vendor_items",
      vendorId ? `vendor_${vendorId}` : null,
      asOf ? `asof_${asOf}` : null,
    ].filter(Boolean);
    const name = nameParts.join("_") + ".csv";

    sendCsv(res, name, csv);
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: String((e as { message?: unknown })?.message ?? e) });
  }
});

// === store_vendor_items 管理（期間管理）========================================

// GET /master/store-vendor-items?storeId=&vendorId=&asOf=YYYY-MM-DD
master.get("/store-vendor-items", (req, res) => {
  try {
    const storeId = req.query.storeId ? ID.store(String(req.query.storeId)) : null;
    const vendorId = req.query.vendorId ? ID.vendor(String(req.query.vendorId)) : null;
    const asOf = req.query.asOf ? String(req.query.asOf).trim() : null;

    if (asOf && !isYmd(asOf)) {
      return res.status(400).json({ ok: false, error: "asOf must be YYYY-MM-DD" });
    }

    const rows = db.prepare(
      `
      SELECT
        svi.id AS id,
        svi.store_id  AS storeId,
        svi.vendor_id AS vendorId,
        svi.item_id   AS itemId,
        svi.valid_from AS validFrom,
        svi.valid_to   AS validTo,

        i.name AS itemName,
        i.spec AS spec,
        i.unit AS unit,
        i.temp_zone AS tempZone
      FROM store_vendor_items svi
      JOIN items i ON i.id = svi.item_id
      WHERE (@storeId IS NULL OR svi.store_id=@storeId)
        AND (@vendorId IS NULL OR svi.vendor_id=@vendorId)
        AND (
          @asOf IS NULL OR (
            svi.valid_from <= @asOf
            AND (svi.valid_to IS NULL OR @asOf <= svi.valid_to)
          )
        )
      ORDER BY svi.store_id, svi.vendor_id, svi.valid_from, svi.item_id
      `
    ).all({ storeId, vendorId, asOf });

    res.json({ ok: true, rows });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// POST /master/store-vendor-items/replace-current
// body: { storeId, vendorId, validFrom, itemIds: string[] }
// 仕様：
// - validFrom 以降の未来行は削除
// - validFrom にかかる現行行は valid_to = validFrom-1日 にして閉じる
// - validFrom からの現行セットを作る（valid_to NULL）
// - vendor_items の現行（validFrom時点）に含まれない itemId は 400 で弾く
master.post("/store-vendor-items/replace-current", (req, res) => {
  try {
    const body = (req.body ?? {}) as any;

    const storeId = ID.store(body.storeId ?? "");
    const vendorId = ID.vendor(body.vendorId ?? "");
    const validFrom = String(body.validFrom ?? "").trim();
    const itemIdsRaw: unknown[] = Array.isArray(body.itemIds) ? (body.itemIds as unknown[]) : [];

    if (!storeId || !vendorId) {
      return res.status(400).json({ ok: false, error: "storeId/vendorId is required" });
    }
    if (!isYmd(validFrom)) {
      return res.status(400).json({ ok: false, error: "validFrom must be YYYY-MM-DD" });
    }

    const itemIds: string[] = itemIdsRaw
      .map((x) => String(ID.item(String(x ?? "")))) // ★ ここで string に確定
      .filter((s: string) => s.length > 0);         // ★ s: string を明示

    if (itemIds.length === 0) {
      return res.status(400).json({ ok: false, error: "itemIds must not be empty" });
    }

    // vendor_items（validFrom 時点の現行）に存在する itemId だけ許可
    const allowed = db.prepare(
      `
      SELECT DISTINCT item_id AS itemId
      FROM vendor_items
      WHERE vendor_id=@vendorId
        AND valid_from <= @asOf
        AND (valid_to IS NULL OR @asOf <= valid_to)
      `
    ).all({ vendorId, asOf: validFrom }) as { itemId: string }[];

    const allowedSet = new Set<string>(allowed.map(r => r.itemId));
    const denied = itemIds.filter((id: string) => !allowedSet.has(id)); // ★ (id: string) を明示
    if (denied.length > 0) {
      return res.status(400).json({
        ok: false,
        error: `some itemIds are not in vendor_items(asOf=${validFrom})`,
        denied,
      });
    }

    const tx = db.transaction(() => {
      // 現行セット（validFrom時点）
      const cur = db.prepare(
        `
        SELECT item_id AS itemId
        FROM store_vendor_items
        WHERE store_id=@storeId AND vendor_id=@vendorId
          AND valid_from <= @asOf
          AND (valid_to IS NULL OR @asOf <= valid_to)
        `
      ).all({ storeId, vendorId, asOf: validFrom }) as { itemId: string }[];

      const curSet = new Set(cur.map(r => r.itemId));
      const nextSet = new Set(itemIds);

      const same =
      curSet.size === nextSet.size &&
      itemIds.every((id: string) => curSet.has(id)); // ★ (id: string) を明示

      // const same =
      //   curSet.size === nextSet.size &&
      //   itemIds.every(id => curSet.has(id));

      // validFrom 以降に “別の未来行” があるか（同一validFromセットだけなら noOp 可能）
      const future = db.prepare(
        `
        SELECT item_id AS itemId, valid_from AS validFrom
        FROM store_vendor_items
        WHERE store_id=@storeId AND vendor_id=@vendorId
          AND valid_from >= @validFrom
        `
      ).all({ storeId, vendorId, validFrom }) as { itemId: string; validFrom: string }[];

      const futureIsOnlySameValidFrom =
        future.length === itemIds.length &&
        future.every(r => r.validFrom === validFrom && nextSet.has(r.itemId));

      if (same && futureIsOnlySameValidFrom) {
        return { noOp: true, count: itemIds.length };
      }

      // validFrom 以降の未来行は削除（同日も含む）
      db.prepare(
        `DELETE FROM store_vendor_items WHERE store_id=@storeId AND vendor_id=@vendorId AND valid_from >= @validFrom`
      ).run({ storeId, vendorId, validFrom });

      // validFrom にかかる現行行を閉じる（validFrom-1日）
      db.prepare(
        `
        UPDATE store_vendor_items
           SET valid_to = date(@validFrom, '-1 day')
         WHERE store_id=@storeId AND vendor_id=@vendorId
           AND valid_from < @validFrom
           AND (valid_to IS NULL OR valid_to >= @validFrom)
        `
      ).run({ storeId, vendorId, validFrom });

      // 新セットを投入（validFromから現行）
      const ins = db.prepare(
        `
        INSERT INTO store_vendor_items (store_id, vendor_id, item_id, valid_from, valid_to)
        VALUES (@storeId, @vendorId, @itemId, @validFrom, NULL)
        `
      );
      for (const itemId of itemIds) {
        ins.run({ storeId, vendorId, itemId, validFrom });
      }

      return { noOp: false, count: itemIds.length };
    });

    const r = tx();
    res.json({ ok: true, storeId, vendorId, validFrom, ...r });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// POST /master/store-vendor-items/import
// body: { csv: string, dryRun?: boolean }
//
// 想定CSV（exportをそのまま想定）：
// storeId, vendorId, itemId, validFrom（storeName/vendorName/itemName/spec/unit/tempZone/validTo はあっても無視）
// ※ storeId×vendorId ごとに validFrom は 1種類だけ（履歴CSVを誤投入する事故を防止）
master.post("/store-vendor-items/import", (req, res) => {
  try {
    const body = (req.body ?? {}) as any;
    const csv = String(body.csv ?? "");
    const dryRun = !!body.dryRun;

    const overrideValidFromRaw = String(body.validFrom ?? "").trim();
    const overrideValidFrom = overrideValidFromRaw ? normalizeYmdLoose(overrideValidFromRaw) : null;
    if (overrideValidFromRaw && !overrideValidFrom) {
      return res.status(400).json({ ok: false, error: "validFrom must be YYYY-MM-DD (or YYYY/MM/DD)" });
    }

    if (!csv.trim()) {
      return res.status(400).json({ ok: false, error: "csv is required" });
    }

    const t = parseTable(csv);
    const h = t.header;

    const cStoreId = findCol(h, ["storeid", "store_id"]);
    const cVendorId = findCol(h, ["vendorid", "vendor_id"]);
    const cItemId = findCol(h, ["itemid", "item_id"]);
    const cValidFrom = findCol(h, ["validfrom", "valid_from"]);

    if (cStoreId < 0 || cVendorId < 0 || cItemId < 0 || cValidFrom < 0) {
      return res.status(400).json({
        ok: false,
        error: "columns required: storeId, vendorId, itemId, validFrom",
        header: h,
      });
    }

    const errors: ImportErr[] = [];
    let dataRows = 0;

    // storeId|vendorId|validFrom => Set(itemId)
    const groups = new Map<string, { storeId: string; vendorId: string; validFrom: string; itemIds: Set<string> }>();
    const validFromByStoreVendor = new Map<string, Set<string>>();

    for (let i = 0; i < t.rows.length; i++) {
      const lineNo = i + 2;
      const r = t.rows[i];
      if (r.every((x) => String(x ?? "").trim() === "")) continue;

      dataRows++;

      const storeId = ID.store(String(r[cStoreId] ?? ""));
      const vendorId = ID.vendor(String(r[cVendorId] ?? ""));
      const itemId = ID.item(String(r[cItemId] ?? ""));
      const validFrom = overrideValidFrom ?? normalizeYmdLoose(r[cValidFrom]);

      if (!storeId) errors.push({ line: lineNo, field: "storeId", message: "invalid", value: String(r[cStoreId] ?? "") });
      if (!vendorId) errors.push({ line: lineNo, field: "vendorId", message: "invalid", value: String(r[cVendorId] ?? "") });
      if (!itemId) errors.push({ line: lineNo, field: "itemId", message: "invalid", value: String(r[cItemId] ?? "") });
      if (!validFrom) errors.push({ line: lineNo, field: "validFrom", message: "invalid date", value: String(r[cValidFrom] ?? "") });

      if (!storeId || !vendorId || !itemId || !validFrom) continue;

      const sv = `${storeId}|${vendorId}`;
      if (!validFromByStoreVendor.has(sv)) validFromByStoreVendor.set(sv, new Set());
      validFromByStoreVendor.get(sv)!.add(validFrom);

      const key = `${storeId}|${vendorId}|${validFrom}`;
      if (!groups.has(key)) groups.set(key, { storeId, vendorId, validFrom, itemIds: new Set() });
      groups.get(key)!.itemIds.add(itemId);
    }

    // 事故防止：store×vendor 単位で validFrom が複数 → 拒否（override が無い時だけ）
    if (!overrideValidFrom) {
      for (const [sv, s] of validFromByStoreVendor.entries()) {
        if (s.size > 1) {
          errors.push({
            line: 1,
            field: "validFrom",
            message: `multiple validFrom for storeId|vendorId ${sv}. split file (this import is for "current set")`,
            value: Array.from(s).sort().join(","),
          });
        }
      }
    }

    // DB存在チェック（まとめて）
    if (errors.length === 0) {
      const storeIds = Array.from(new Set(Array.from(groups.values()).map((g) => g.storeId)));
      if (storeIds.length > 0) {
        const ph = storeIds.map(() => "?").join(",");
        const found = db.prepare(`SELECT id FROM stores WHERE id IN (${ph})`).all(...storeIds) as { id: string }[];
        const set = new Set(found.map((x) => x.id));
        const missing = storeIds.filter((id) => !set.has(id));
        if (missing.length) errors.push({ line: 1, field: "storeId", message: `store not found: ${missing.join(",")}` });
      }

      const vendorIds = Array.from(new Set(Array.from(groups.values()).map((g) => g.vendorId)));
      if (vendorIds.length > 0) {
        const ph = vendorIds.map(() => "?").join(",");
        const found = db.prepare(`SELECT id FROM vendors WHERE id IN (${ph})`).all(...vendorIds) as { id: string }[];
        const set = new Set(found.map((x) => x.id));
        const missing = vendorIds.filter((id) => !set.has(id));
        if (missing.length) errors.push({ line: 1, field: "vendorId", message: `vendor not found: ${missing.join(",")}` });
      }

      const itemIds = Array.from(
        new Set(Array.from(groups.values()).flatMap((g) => Array.from(g.itemIds.values())))
      );
      if (itemIds.length > 0) {
        const ph = itemIds.map(() => "?").join(",");
        const found = db.prepare(`SELECT id FROM items WHERE id IN (${ph})`).all(...itemIds) as { id: string }[];
        const set = new Set(found.map((x) => x.id));
        const missing = itemIds.filter((id) => !set.has(id));
        if (missing.length) errors.push({ line: 1, field: "itemId", message: `item not found: ${missing.join(",")}` });
      }
    }

    // vendor_items(asOf=validFrom) に無い item が混ざってないか（groupごと）
    if (errors.length === 0) {
      const qAllowed = db.prepare(`
        SELECT DISTINCT item_id AS itemId
        FROM vendor_items
        WHERE vendor_id=@vendorId
          AND valid_from <= @asOf
          AND (valid_to IS NULL OR @asOf <= valid_to)
      `);

      for (const g of groups.values()) {
        const allowed = qAllowed.all({ vendorId: g.vendorId, asOf: g.validFrom }) as { itemId: string }[];
        const allowedSet = new Set(allowed.map((r) => r.itemId));
        const denied = Array.from(g.itemIds.values()).filter((id) => !allowedSet.has(id));
        if (denied.length > 0) {
          errors.push({
            line: 1,
            field: "itemId",
            message: `some itemIds are not in vendor_items(asOf=${g.validFrom}) for vendor ${g.vendorId}`,
            value: denied.slice(0, 50).join(","),
          });
        }
      }
    }

    // dryRun or errors
    if (dryRun || errors.length > 0) {
      return res.json({
        ok: true,
        dryRun: true,
        rows: dataRows,
        groups: groups.size,
        appliedGroups: 0,
        noOpGroups: 0,
        errors,
      });
    }

    // apply（replace-current と同じ “未来削除＋被り閉じ＋INSERT”）
    const ordered = Array.from(groups.values()).sort((a, b) => {
      const ak = `${a.storeId}|${a.vendorId}|${a.validFrom}`;
      const bk = `${b.storeId}|${b.vendorId}|${b.validFrom}`;
      return ak.localeCompare(bk);
    });

    const tx = db.transaction(() => {
      let appliedGroups = 0;
      let noOpGroups = 0;

      const qCur = db.prepare(`
        SELECT item_id AS itemId
        FROM store_vendor_items
        WHERE store_id=@storeId AND vendor_id=@vendorId
          AND valid_from <= @asOf
          AND (valid_to IS NULL OR @asOf <= valid_to)
        ORDER BY item_id
      `);

      const qFuture = db.prepare(`
        SELECT item_id AS itemId, valid_from AS validFrom
        FROM store_vendor_items
        WHERE store_id=@storeId AND vendor_id=@vendorId
          AND valid_from >= @validFrom
      `);

      const delFuture = db.prepare(`
        DELETE FROM store_vendor_items
        WHERE store_id=@storeId AND vendor_id=@vendorId
          AND valid_from >= @validFrom
      `);

      const closeCover = db.prepare(`
        UPDATE store_vendor_items
           SET valid_to = date(@validFrom, '-1 day')
         WHERE store_id=@storeId AND vendor_id=@vendorId
           AND valid_from < @validFrom
           AND (valid_to IS NULL OR valid_to >= @validFrom)
      `);

      const ins = db.prepare(`
        INSERT INTO store_vendor_items (store_id, vendor_id, item_id, valid_from, valid_to)
        VALUES (@storeId, @vendorId, @itemId, @validFrom, NULL)
      `);

      for (const g of ordered) {
        const storeId = g.storeId;
        const vendorId = g.vendorId;
        const validFrom = g.validFrom;
        const itemIds = Array.from(g.itemIds.values()).sort();

        // no-op判定（同じセット & 未来に同日セットしか無いなら何もしない）
        const cur = qCur.all({ storeId, vendorId, asOf: validFrom }) as { itemId: string }[];
        const curSet = new Set(cur.map((r) => r.itemId));
        const nextSet = new Set(itemIds);

        const same = curSet.size === nextSet.size && itemIds.every((id) => curSet.has(id));

        const future = qFuture.all({ storeId, vendorId, validFrom }) as { itemId: string; validFrom: string }[];
        const futureIsOnlySameValidFrom =
          future.length === itemIds.length &&
          future.every((r) => r.validFrom === validFrom && nextSet.has(r.itemId));

        if (same && futureIsOnlySameValidFrom) {
          noOpGroups++;
          continue;
        }

        delFuture.run({ storeId, vendorId, validFrom });
        closeCover.run({ storeId, vendorId, validFrom });

        for (const itemId of itemIds) {
          ins.run({ storeId, vendorId, itemId, validFrom });
        }

        appliedGroups++;
      }

      return { appliedGroups, noOpGroups };
    });

    const r = tx();
    return res.json({
      ok: true,
      dryRun: false,
      rows: dataRows,
      groups: groups.size,
      appliedGroups: r.appliedGroups,
      noOpGroups: r.noOpGroups,
      errors: [],
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

master.post("/item-prices/import", (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const csv = String(body.csv ?? "");
    const dryRun = body.dryRun !== false;

    if (!csv.trim()) return res.status(400).json({ ok: false, error: "csv is required" });

    const t = parseTable(csv);
    if (!t.header.length) return res.status(400).json({ ok: false, error: "csv header is required" });

    const header = t.header;

    const cVendorId   = findCol(header, ["vendorId"]);
    const cItemId     = findCol(header, ["itemId"]);
    const cUnitPrice  = findCol(header, ["unitPrice"]);
    const cValidFrom  = findCol(header, ["validFrom"]);
    const cValidTo    = findCol(header, ["validTo"]);
    const cId         = findCol(header, ["id"]);

    if (cVendorId < 0 || cItemId < 0 || cUnitPrice < 0 || cValidFrom < 0) {
      return res.status(400).json({
        ok: false,
        error: "required columns: vendorId,itemId,unitPrice,validFrom (optional: validTo,id)",
      });
    }

    type Row = {
      line: number;
      id?: number;
      vendorId: string;
      itemId: string;
      unitPrice: number;
      validFrom: string;
      validTo: string | null;
    };

    const errors: ImportErr[] = [];
    const rows: Row[] = [];

    const uniqVendors = new Set<string>();
    const uniqItems = new Set<string>();

    for (let i = 0; i < t.rows.length; i++) {
      const line = i + 2;
      const r = t.rows[i];

      const vendorId = ID.vendor(String(r[cVendorId] ?? ""));
      const itemId = ID.item(String(r[cItemId] ?? ""));

      if (!vendorId) { errors.push({ line, field: "vendorId", message: "invalid vendorId", value: String(r[cVendorId] ?? "") }); continue; }
      if (!itemId) { errors.push({ line, field: "itemId", message: "invalid itemId", value: String(r[cItemId] ?? "") }); continue; }

      const unitPriceRaw = String(r[cUnitPrice] ?? "").replace(/,/g, "").trim();
      const unitPrice = Number(unitPriceRaw);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        errors.push({ line, field: "unitPrice", message: "unitPrice must be a number (>=0)", value: unitPriceRaw });
        continue;
      }

      const validFrom = normalizeYmdLoose(String(r[cValidFrom] ?? ""));
      if (!validFrom) { errors.push({ line, field: "validFrom", message: "invalid validFrom", value: String(r[cValidFrom] ?? "") }); continue; }

      const validToRaw = cValidTo >= 0 ? String(r[cValidTo] ?? "").trim() : "";
      const validTo = validToRaw ? normalizeYmdLoose(validToRaw) : null;
      if (validToRaw && !validTo) {
        errors.push({ line, field: "validTo", message: "invalid validTo", value: validToRaw });
        continue;
      }
      if (validTo && validTo < validFrom) {
        errors.push({ line, field: "validTo", message: "validTo must be >= validFrom", value: validToRaw });
        continue;
      }

      let id: number | undefined = undefined;
      if (cId >= 0) {
        const idRaw = String(r[cId] ?? "").trim();
        if (idRaw !== "") {
          const n = Number(idRaw);
          if (!Number.isFinite(n) || n <= 0) {
            errors.push({ line, field: "id", message: "id must be a positive number", value: idRaw });
            continue;
          }
          id = Math.trunc(n);
        }
      }

      rows.push({ line, id, vendorId, itemId, unitPrice, validFrom, validTo });
      uniqVendors.add(vendorId);
      uniqItems.add(itemId);
    }

    // 存在チェック（vendors/items）
    if (errors.length === 0) {
      const vs = Array.from(uniqVendors);
      const is = Array.from(uniqItems);

      const vPh = vs.map(() => "?").join(",");
      const iPh = is.map(() => "?").join(",");

      const foundV = db.prepare(`SELECT id FROM vendors WHERE id IN (${vPh})`).all(...vs) as { id: string }[];
      const foundI = db.prepare(`SELECT id FROM items  WHERE id IN (${iPh})`).all(...is) as { id: string }[];

      const vSet = new Set(foundV.map((x) => x.id));
      const iSet = new Set(foundI.map((x) => x.id));

      for (const rr of rows) {
        if (!vSet.has(rr.vendorId)) errors.push({ line: rr.line, field: "vendorId", message: `vendor not found: ${rr.vendorId}`, value: rr.vendorId });
        if (!iSet.has(rr.itemId)) errors.push({ line: rr.line, field: "itemId", message: `item not found: ${rr.itemId}`, value: rr.itemId });
      }
    }

    // insert/update 見積もり
    let inserted = 0;
    let updated = 0;

    const findByKey = db.prepare(
      `SELECT id FROM item_prices WHERE vendor_id=? AND item_id=? AND valid_from=?`
    );

    for (const rr of rows) {
      if (rr.id != null) {
        const ex = db.prepare(`SELECT 1 FROM item_prices WHERE id=?`).get(rr.id);
        if (ex) updated++; else inserted++;
      } else {
        const ex = findByKey.get(rr.vendorId, rr.itemId, rr.validFrom) as { id: number } | undefined;
        if (ex) updated++; else inserted++;
      }
    }

    if (errors.length > 0 || dryRun) {
      return res.json({ ok: true, dryRun: true, rows: rows.length, inserted, updated, errors });
    }

    const tx = db.transaction(() => {
      for (const rr of rows) {
        // 対象ID決定（id優先、なければ自然キー）
        let targetId: number | null = rr.id ?? null;
        if (targetId == null) {
          const ex = findByKey.get(rr.vendorId, rr.itemId, rr.validFrom) as { id: number } | undefined;
          if (ex?.id) targetId = ex.id;
        }

        // 重複期間チェック（同 vendor×item の他行と overlap しないこと）
        const existing = db.prepare(
          `SELECT id, valid_from AS validFrom, valid_to AS validTo
             FROM item_prices
            WHERE vendor_id=? AND item_id=?`
        ).all(rr.vendorId, rr.itemId) as { id: number; validFrom: string; validTo: string | null }[];

        for (const ex of existing) {
          if (targetId != null && ex.id === targetId) continue;
          if (overlaps(rr.validFrom, rr.validTo, ex.validFrom, ex.validTo)) {
            throw new Error(
              `overlap item_prices: vendor=${rr.vendorId} item=${rr.itemId} ` +
              `(${rr.validFrom}..${rr.validTo ?? "NULL"}) overlaps (${ex.validFrom}..${ex.validTo ?? "NULL"})`
            );
          }
        }

        if (targetId != null) {
          db.prepare(
            `UPDATE item_prices
                SET vendor_id=?, item_id=?, unit_price=?, valid_from=?, valid_to=?
              WHERE id=?`
          ).run(rr.vendorId, rr.itemId, rr.unitPrice, rr.validFrom, rr.validTo, targetId);
        } else if (rr.id != null) {
          db.prepare(
            `INSERT INTO item_prices (id, vendor_id, item_id, unit_price, valid_from, valid_to)
             VALUES (?,?,?,?,?,?)`
          ).run(rr.id, rr.vendorId, rr.itemId, rr.unitPrice, rr.validFrom, rr.validTo);
        } else {
          db.prepare(
            `INSERT INTO item_prices (vendor_id, item_id, unit_price, valid_from, valid_to)
             VALUES (?,?,?,?,?)`
          ).run(rr.vendorId, rr.itemId, rr.unitPrice, rr.validFrom, rr.validTo);
        }
      }
    });

    tx();
    return res.json({ ok: true, dryRun: false, rows: rows.length, inserted, updated, errors: [] });
  } catch (e: unknown) {
    return res.status(500).json({ ok: false, error: String((e as { message?: unknown })?.message ?? e) });
  }
});

// --- 追加：store_vendor_items 差分更新（toggle） ----------------------

type StoreVendorItemsToggleChange = { itemId: string; enabled: boolean };

/**
 * store_vendor_items 差分更新（toggle）
 * body: { storeId, vendorId, validFrom, changes: [{ itemId, enabled }] }
 *
 * - 対象 item のみ反映
 * - enabled=true は vendor_items（validFrom時点）に存在する itemId のみ許可
 */
master.post("/store-vendor-items/toggle", (req, res) => {
  try {
    const body = (req.body ?? {}) as any;

    const storeId = ID.store(String(body.storeId ?? ""));
    const vendorId = ID.vendor(String(body.vendorId ?? ""));
    const validFrom = String(body.validFrom ?? "").trim();
    const changesRaw = Array.isArray(body.changes) ? body.changes : [];

    if (!storeId) return res.status(400).json({ ok: false, error: "storeId is required" });
    if (!vendorId) return res.status(400).json({ ok: false, error: "vendorId is required" });
    if (!isYmd2(validFrom)) return res.status(400).json({ ok: false, error: "validFrom must be YYYY-MM-DD" });

    const changes: StoreVendorItemsToggleChange[] = changesRaw.map((c: any) => {
      const itemId = ID.item(String(c?.itemId ?? ""));
      const enabled = parseEnabled(c?.enabled);
      if (!itemId) throw new Error("changes.itemId is invalid");
      if (enabled === null) throw new Error("changes.enabled must be boolean");
      return { itemId, enabled };
    });

    // 重複（同一 itemId）は最後を優先
    const lastByItem = new Map<string, boolean>();
    for (const c of changes) lastByItem.set(c.itemId, c.enabled);
    const uniqChanges = Array.from(lastByItem.entries()).map(([itemId, enabled]) => ({ itemId, enabled }));

    if (uniqChanges.length === 0) {
      return res.json({ ok: true as const, storeId, vendorId, validFrom, requested: 0, applied: 0, noOp: true as const });
    }

    // 存在チェック：store / vendor
    const s = db.prepare(`SELECT 1 FROM stores WHERE id=?`).get(storeId);
    if (!s) return res.status(400).json({ ok: false, error: `store not found: ${storeId}` });

    const v = db.prepare(`SELECT 1 FROM vendors WHERE id=?`).get(vendorId);
    if (!v) return res.status(400).json({ ok: false, error: `vendor not found: ${vendorId}` });

    // vendor_items（validFrom時点）の許可セット
    const vendorCur = db.prepare(
      `
      SELECT item_id AS itemId
      FROM vendor_items
      WHERE vendor_id=@vendorId
        AND valid_from <= @asOf
        AND (valid_to IS NULL OR valid_to >= @asOf)
      `
    ).all({ vendorId, asOf: validFrom }) as { itemId: string }[];

    const allowSet = new Set(vendorCur.map((r) => r.itemId));

    const denied = uniqChanges
      .filter((c) => c.enabled && !allowSet.has(c.itemId))
      .map((c) => c.itemId);

    if (denied.length > 0) {
      return res.status(400).json({
        ok: false,
        error: `items are not in vendor_items(asOf=${validFrom}): ${denied.join(",")}`,
      });
    }

    const tx = db.transaction(() => {
      const existsAt = db.prepare(
        `
        SELECT 1
        FROM store_vendor_items
        WHERE store_id=@storeId
          AND vendor_id=@vendorId
          AND item_id=@itemId
          AND valid_from <= @asOf
          AND (valid_to IS NULL OR valid_to >= @asOf)
        LIMIT 1
        `
      );

      const delFuture = db.prepare(
        `
        DELETE FROM store_vendor_items
        WHERE store_id=@storeId
          AND vendor_id=@vendorId
          AND item_id=@itemId
          AND valid_from >= @validFrom
        `
      );

      const closeCover = db.prepare(
        `
        UPDATE store_vendor_items
           SET valid_to = date(@validFrom, '-1 day')
         WHERE store_id=@storeId
           AND vendor_id=@vendorId
           AND item_id=@itemId
           AND valid_from < @validFrom
           AND (valid_to IS NULL OR valid_to >= @validFrom)
        `
      );

      const ins = db.prepare(
        `
        INSERT INTO store_vendor_items (store_id, vendor_id, item_id, valid_from, valid_to)
        VALUES (@storeId, @vendorId, @itemId, @validFrom, NULL)
        `
      );

      let applied = 0;

      for (const c of uniqChanges) {
        const curOn = !!existsAt.get({ storeId, vendorId, itemId: c.itemId, asOf: validFrom });
        if (curOn === c.enabled) continue;

        delFuture.run({ storeId, vendorId, itemId: c.itemId, validFrom });
        closeCover.run({ storeId, vendorId, itemId: c.itemId, validFrom });
        if (c.enabled) ins.run({ storeId, vendorId, itemId: c.itemId, validFrom });

        applied++;
      }

      return {
        ok: true as const,
        storeId,
        vendorId,
        validFrom,
        requested: uniqChanges.length,
        applied,
        noOp: applied === 0,
      };
    });

    return res.json(tx());
  } catch (e: unknown) {
    return res.status(500).json({ ok: false, error: String((e as { message?: unknown })?.message ?? e) });
  }
});

// GET /master/store-vendor-items.csv?storeId=&vendorId=&asOf=
master.get("/store-vendor-items.csv", (req, res) => {
  try {
    const storeId = req.query.storeId ? ID.store(String(req.query.storeId)) : null;
    const vendorId = req.query.vendorId ? ID.vendor(String(req.query.vendorId)) : null;
    const asOf = req.query.asOf ? String(req.query.asOf).trim() : null;

    if (asOf && !isYmd(asOf)) {
      return res.status(400).json({ ok: false, error: "asOf must be YYYY-MM-DD" });
    }

    const rows = db.prepare(
      `
      SELECT
        svi.store_id  AS storeId,
        st.name      AS storeName,
        svi.vendor_id AS vendorId,
        v.name       AS vendorName,
        svi.item_id  AS itemId,
        i.name       AS itemName,
        i.spec       AS spec,
        i.unit       AS unit,
        i.temp_zone  AS tempZone,
        svi.valid_from AS validFrom,
        svi.valid_to   AS validTo
      FROM store_vendor_items svi
      LEFT JOIN stores st ON st.id = svi.store_id
      LEFT JOIN vendors v ON v.id = svi.vendor_id
      LEFT JOIN items i ON i.id = svi.item_id
      WHERE (@storeId IS NULL OR svi.store_id=@storeId)
        AND (@vendorId IS NULL OR svi.vendor_id=@vendorId)
        AND (
          @asOf IS NULL OR (
            svi.valid_from <= @asOf
            AND (svi.valid_to IS NULL OR @asOf <= svi.valid_to)
          )
        )
      ORDER BY svi.store_id, svi.vendor_id, svi.valid_from, svi.item_id
      `
    ).all({ storeId, vendorId, asOf }) as any[];

    const dateStyle = csvDateStyleFromQuery(req.query.dateStyle);
    const esc = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [];
    lines.push([
      "storeId","storeName","vendorId","vendorName","itemId","itemName","spec","unit","tempZone","validFrom","validTo"
    ].join(","));
    for (const r of rows) {
      lines.push([
        esc(r.storeId), esc(r.storeName),
        esc(r.vendorId), esc(r.vendorName),
        esc(r.itemId), esc(r.itemName),
        esc(r.spec), esc(r.unit), esc(r.tempZone),
        esc(formatDateForCsv(r.validFrom, dateStyle)),
        esc(formatDateForCsv(r.validTo, dateStyle)),
      ].join(","));
    }

    // ★ asOf をファイル名に付与（判別しやすく）
    const filename =
      `store_vendor_items${storeId ? "_" + storeId : ""}${vendorId ? "_" + vendorId : ""}${asOf ? "_asof_" + asOf : ""}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send("\uFEFF" + lines.join("\n"));
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// === CSV export（運用確認用）====================================

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // CSVエスケープ（カンマ/改行/ダブルクォート）
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(cols: unknown[]): string {
  return cols.map(csvCell).join(",");
}

function toCsv(lines: unknown[][]): string {
  return lines.map(csvLine).join("\r\n") + "\r\n";
}

function sendCsv(res: any, filename: string, csv: string) {
  // Excel向けにBOMを付与（日本語ヘッダ想定）
  const body = "\uFEFF" + csv;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
}

/** vendor_weekly_rules CSV */
master.get("/vendor-weekly-rules.csv", (req, res) => {
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
      .all({ vendorId }) as any[];

    const header = [
      "vendorId",
      "updatedAt",
      "sun_orderable",
      "sun_cutoff",
      "sun_lead",
      "mon_orderable",
      "mon_cutoff",
      "mon_lead",
      "tue_orderable",
      "tue_cutoff",
      "tue_lead",
      "wed_orderable",
      "wed_cutoff",
      "wed_lead",
      "thu_orderable",
      "thu_cutoff",
      "thu_lead",
      "fri_orderable",
      "fri_cutoff",
      "fri_lead",
      "sat_orderable",
      "sat_cutoff",
      "sat_lead",
    ];

    const lines: unknown[][] = [header];

    for (const r of rows) {
      lines.push([
        r.vendorId ?? "",
        r.updatedAt ?? "",
        r.orderableSun ?? "",
        r.cutoffHhmmSun ?? "",
        r.leadTimeDaysSun ?? "",
        r.orderableMon ?? "",
        r.cutoffHhmmMon ?? "",
        r.leadTimeDaysMon ?? "",
        r.orderableTue ?? "",
        r.cutoffHhmmTue ?? "",
        r.leadTimeDaysTue ?? "",
        r.orderableWed ?? "",
        r.cutoffHhmmWed ?? "",
        r.leadTimeDaysWed ?? "",
        r.orderableThu ?? "",
        r.cutoffHhmmThu ?? "",
        r.leadTimeDaysThu ?? "",
        r.orderableFri ?? "",
        r.cutoffHhmmFri ?? "",
        r.leadTimeDaysFri ?? "",
        r.orderableSat ?? "",
        r.cutoffHhmmSat ?? "",
        r.leadTimeDaysSat ?? "",
      ]);
    }

    const name = vendorId ? `vendor_weekly_rules_${vendorId}.csv` : "vendor_weekly_rules.csv";
    sendCsv(res, name, toCsv(lines));
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/** store_vendor_overrides CSV */
master.get("/store-vendor-overrides.csv", (req, res) => {
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
      .all({ storeId, vendorId }) as any[];

    const header = [
      "storeId",
      "vendorId",
      "updatedAt",
      "sun_orderable_ovr",
      "sun_cutoff_ovr",
      "sun_lead_ovr",
      "mon_orderable_ovr",
      "mon_cutoff_ovr",
      "mon_lead_ovr",
      "tue_orderable_ovr",
      "tue_cutoff_ovr",
      "tue_lead_ovr",
      "wed_orderable_ovr",
      "wed_cutoff_ovr",
      "wed_lead_ovr",
      "thu_orderable_ovr",
      "thu_cutoff_ovr",
      "thu_lead_ovr",
      "fri_orderable_ovr",
      "fri_cutoff_ovr",
      "fri_lead_ovr",
      "sat_orderable_ovr",
      "sat_cutoff_ovr",
      "sat_lead_ovr",
    ];

    const lines: unknown[][] = [header];

    for (const r of rows) {
      lines.push([
        r.storeId ?? "",
        r.vendorId ?? "",
        r.updatedAt ?? "",
        r.orderableSunOverride ?? "",
        r.cutoffHhmmSunOverride ?? "",
        r.leadTimeDaysSunOverride ?? "",
        r.orderableMonOverride ?? "",
        r.cutoffHhmmMonOverride ?? "",
        r.leadTimeDaysMonOverride ?? "",
        r.orderableTueOverride ?? "",
        r.cutoffHhmmTueOverride ?? "",
        r.leadTimeDaysTueOverride ?? "",
        r.orderableWedOverride ?? "",
        r.cutoffHhmmWedOverride ?? "",
        r.leadTimeDaysWedOverride ?? "",
        r.orderableThuOverride ?? "",
        r.cutoffHhmmThuOverride ?? "",
        r.leadTimeDaysThuOverride ?? "",
        r.orderableFriOverride ?? "",
        r.cutoffHhmmFriOverride ?? "",
        r.leadTimeDaysFriOverride ?? "",
        r.orderableSatOverride ?? "",
        r.cutoffHhmmSatOverride ?? "",
        r.leadTimeDaysSatOverride ?? "",
      ]);
    }

    const nameParts = [
      "store_vendor_overrides",
      storeId ? `store_${storeId}` : null,
      vendorId ? `vendor_${vendorId}` : null,
    ].filter(Boolean);
    const name = nameParts.join("_") + ".csv";

    sendCsv(res, name, toCsv(lines));
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// 追加：GET /master/item-prices.csv
// query: vendorId?, itemId?, asOf? (YYYY-MM-DD)
master.get("/item-prices.csv", (req, res) => {
  try {
    const vendorIdRaw = String(req.query.vendorId ?? "").trim();
    const itemIdRaw = String(req.query.itemId ?? "").trim();

    const vendorId = vendorIdRaw ? vendorIdRaw.replace(/\D/g, "").padStart(6, "0") : null;
    const itemId = itemIdRaw ? itemIdRaw.replace(/\D/g, "").padStart(6, "0") : null;

    // ★ asOf（任意）
    const asOf = req.query.asOf ? String(req.query.asOf).trim() : null;
    if (asOf && !isYmd(asOf)) {
      return res.status(400).json({ ok: false, error: "asOf must be YYYY-MM-DD" });
    }

    type ItemPriceCsvRow = {
      id: number;
      vendorId: string;
      vendorName: string;
      itemId: string;
      itemName: string;
      unitPrice: number;
      validFrom: string | null;
      validTo: string | null;
    };

    const rows = db
      .prepare(
        `
        SELECT
          p.id          AS id,
          p.vendor_id   AS vendorId,
          COALESCE(v.name, '') AS vendorName,
          p.item_id     AS itemId,
          COALESCE(i.name, '') AS itemName,
          p.unit_price  AS unitPrice,
          p.valid_from  AS validFrom,
          p.valid_to    AS validTo
        FROM item_prices p
        LEFT JOIN vendors v ON v.id = p.vendor_id
        LEFT JOIN items   i ON i.id = p.item_id
        WHERE (@vendorId IS NULL OR p.vendor_id = @vendorId)
          AND (@itemId   IS NULL OR p.item_id   = @itemId)
          AND (
            @asOf IS NULL OR (
              p.valid_from <= @asOf
              AND (p.valid_to IS NULL OR @asOf <= p.valid_to)
            )
          )
        ORDER BY p.vendor_id, p.item_id, p.valid_from, p.id
        `
      )
      .all({ vendorId, itemId, asOf }) as ItemPriceCsvRow[];

    const dateStyle = csvDateStyleFromQuery(req.query.dateStyle);
    const lines: unknown[][] = [
      ["vendorId", "vendorName", "itemId", "itemName", "unitPrice", "validFrom", "validTo", "id"],
    ];

    for (const r of rows) {
      lines.push([
        r.vendorId ?? "",
        r.vendorName ?? "",
        r.itemId ?? "",
        r.itemName ?? "",
        r.unitPrice ?? "",
        formatDateForCsv(r.validFrom ?? "", dateStyle),
        formatDateForCsv(r.validTo ?? "", dateStyle),
        r.id ?? "",
      ]);
    }

    const csv = lines
      .map((row) => row.map((x) => JSON.stringify(String(x ?? ""))).join(","))
      .join("\n");

    const ymd = new Date().toISOString().slice(0, 10);
    const suffix = [
      vendorId ? `vendor-${vendorId}` : "allvendors",
      itemId ? `item-${itemId}` : "allitems",
      asOf ? `asof-${asOf}` : "history",
      ymd,
    ].join("_");

    sendCsv(res, `item_prices_${suffix}.csv`, csv);
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: String((e as any)?.message ?? e) });
  }
});

type TempZone = "ambient" | "chilled" | "frozen";
function isTempZone(v: string): v is TempZone {
  return v === "ambient" || v === "chilled" || v === "frozen";
}
function toNullIfBlank(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}
// ===== CSV import（items） =====
type CsvImportError = { line: number; field?: string; message: string; value?: string };

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function parseCsvLineStd(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur.trim());
        cur = "";
      } else if (ch === '"') {
        inQ = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur.trim());
  return out;
}

// 1) JSON.stringify で作ったCSV行（ "a","b","c" ）は JSON配列として読める
// 2) Excel等の通常CSVは std パーサで読む
function parseCsvLineLoose(line: string): string[] {
  const t = line.replace(/\r$/, "");
  if (!t.trim()) return [];
  try {
    const arr = JSON.parse(`[${t}]`);
    if (Array.isArray(arr)) return arr.map((v) => String(v ?? "").trim());
  } catch {}
  return parseCsvLineStd(t);
}

function parseCsvText(text: string): { header: string[]; rows: string[][] } {
  const s = stripBom(String(text ?? "")).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = s.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return { header: [], rows: [] };
  const header = parseCsvLineLoose(lines[0]).map((h) => String(h ?? "").trim());
  const rows = lines.slice(1).map(parseCsvLineLoose);
  return { header, rows };
}

function parse01(v: string, def: 0 | 1): 0 | 1 {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "") return def;
  if (s === "1" || s === "true" || s === "yes" || s === "y") return 1;
  if (s === "0" || s === "false" || s === "no" || s === "n") return 0;
  const n = Number(s);
  if (Number.isFinite(n)) return n ? 1 : 0;
  return def;
}
master.post("/items/upsert", (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const id = ID.item(String(body.id ?? ""));
    const name = String(body.name ?? "").trim();
    const unit = String(body.unit ?? "").trim();
    const spec = toNullIfBlank(body.spec);
    const tempZoneRaw = String(body.tempZone ?? "").trim() || "ambient";
    const stockUnit = toNullIfBlank(body.stockUnit);
    const stockConvRaw = Number(body.stockConv ?? 1);
    const isActive = Number(body.isActive ?? 1) ? 1 : 0;

    if (!id) return res.status(400).json({ ok: false, error: "id is required" });
    if (!name) return res.status(400).json({ ok: false, error: "name is required" });
    if (!unit) return res.status(400).json({ ok: false, error: "unit is required" });
    if (!isTempZone(tempZoneRaw)) {
      return res.status(400).json({ ok: false, error: "tempZone must be ambient/chilled/frozen" });
    }
    if (!Number.isFinite(stockConvRaw) || stockConvRaw <= 0) {
      return res.status(400).json({ ok: false, error: "stockConv must be number > 0" });
    }

    const exists = db.prepare(`SELECT 1 FROM items WHERE id=?`).get(id);

    if (exists) {
      db.prepare(
        `
        UPDATE items
           SET name=?,
               unit=?,
               spec=?,
               temp_zone=?,
               is_active=?,
               stock_unit=?,
               stock_conv=?
         WHERE id=?
        `
      ).run(name, unit, spec, tempZoneRaw, isActive, stockUnit, stockConvRaw, id);
    } else {
      db.prepare(
        `
        INSERT INTO items (id, name, unit, spec, temp_zone, is_active, stock_unit, stock_conv)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).run(id, name, unit, spec, tempZoneRaw, isActive, stockUnit, stockConvRaw);
    }

    res.json({ ok: true, id });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: String((e as any)?.message ?? e) });
  }
});

/**
 * items CSV import
 * body: { csv: string, dryRun?: boolean }
 * 必須列: id,name,unit,tempZone,isActive,stockConv （順不同OK・余計な列OK）
 * 任意列: spec,stockUnit
 */
master.post("/items/import", (req, res) => {
  try {
    const body = (req.body ?? {}) as any;
    const dryRun = !!body.dryRun;
    const csvText = String(body.csv ?? "");
    if (!csvText.trim()) return res.status(400).json({ ok: false, error: "csv is required" });

    const { header, rows } = parseCsvText(csvText);
    if (header.length === 0) return res.status(400).json({ ok: false, error: "csv header is missing" });

    // header は大小/スネークを吸収
    const h = header.map((x) => String(x ?? "").trim().replace(/^\uFEFF/, "").toLowerCase());
    const idx = (name: string) => h.indexOf(name.toLowerCase());
    const col = {
      id: idx("id"),
      name: idx("name"),
      unit: idx("unit"),
      spec: idx("spec"),
      tempZone: idx("tempzone") >= 0 ? idx("tempzone") : idx("temp_zone"),
      isActive: idx("isactive") >= 0 ? idx("isactive") : idx("is_active"),
      stockUnit: idx("stockunit") >= 0 ? idx("stockunit") : idx("stock_unit"),
      stockConv: idx("stockconv") >= 0 ? idx("stockconv") : idx("stock_conv"),
    };

    const required = ["id", "name", "unit", "tempZone", "isActive", "stockConv"] as const;
    for (const k of required) {
      if ((col as any)[k] < 0) {
        return res.status(400).json({ ok: false, error: `missing required column: ${k}` });
      }
    }

    const errors: CsvImportError[] = [];
    const items: Array<{
      id: string;
      name: string;
      unit: string;
      spec: string | null;
      tempZone: TempZone;
      isActive: 0 | 1;
      stockUnit: string | null;
      stockConv: number;
    }> = [];

    const seen = new Set<string>();
    const maxRows = 5000;
    const dataRows = rows.slice(0, maxRows);

    for (let i = 0; i < dataRows.length; i++) {
      const lineNo = i + 2; // header=1, data starts at 2
      const r = dataRows[i] ?? [];
      const get = (j: number) => (j >= 0 ? String(r[j] ?? "").trim() : "");

      const id = ID.item(get(col.id));
      const name = get(col.name);
      const unit = get(col.unit);
      const spec = toNullIfBlank(get(col.spec));
      const tzRaw = get(col.tempZone) || "ambient";
      const isActive = parse01(get(col.isActive), 1);
      const stockUnit = toNullIfBlank(get(col.stockUnit));
      const stockConvRaw = Number(get(col.stockConv) || "1");

      if (!id) errors.push({ line: lineNo, field: "id", message: "id is required", value: get(col.id) });
      if (!name) errors.push({ line: lineNo, field: "name", message: "name is required" });
      if (!unit) errors.push({ line: lineNo, field: "unit", message: "unit is required" });
      if (!isTempZone(tzRaw)) errors.push({ line: lineNo, field: "tempZone", message: "tempZone must be ambient/chilled/frozen", value: tzRaw });
      if (!Number.isFinite(stockConvRaw) || stockConvRaw <= 0) errors.push({ line: lineNo, field: "stockConv", message: "stockConv must be number > 0", value: get(col.stockConv) });

      if (id) {
        if (seen.has(id)) errors.push({ line: lineNo, field: "id", message: "duplicate id in CSV", value: id });
        seen.add(id);
      }

      if (id && name && unit && isTempZone(tzRaw) && Number.isFinite(stockConvRaw) && stockConvRaw > 0) {
        items.push({
          id,
          name,
          unit,
          spec,
          tempZone: tzRaw,
          isActive,
          stockUnit,
          stockConv: stockConvRaw,
        });
      }
    }

    // 既存判定（insert / update 件数）
    const ids = items.map((x) => x.id);
    let inserted = 0;
    let updated = 0;
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      const found = db.prepare(`SELECT id FROM items WHERE id IN (${placeholders})`).all(...ids) as { id: string }[];
      const foundSet = new Set(found.map((x) => x.id));
      for (const id of ids) (foundSet.has(id) ? updated++ : inserted++);
    }

    // dryRun は 200 で返す（エラーも一覧できる）
    if (dryRun) {
      return res.json({ ok: true, dryRun: true, rows: items.length, inserted, updated, errors });
    }

    if (errors.length > 0) {
      return res.status(400).json({ ok: false, error: "validation failed", errors });
    }

    const tx = db.transaction(() => {
      const ins = db.prepare(
        `
        INSERT INTO items (id, name, unit, spec, temp_zone, is_active, stock_unit, stock_conv)
        VALUES (@id, @name, @unit, @spec, @tempZone, @isActive, @stockUnit, @stockConv)
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name,
          unit=excluded.unit,
          spec=excluded.spec,
          temp_zone=excluded.temp_zone,
          is_active=excluded.is_active,
          stock_unit=excluded.stock_unit,
          stock_conv=excluded.stock_conv
        `
      );
      for (const it of items) ins.run(it);
    });
    tx();

    res.json({ ok: true, dryRun: false, rows: items.length, inserted, updated, errors: [] as CsvImportError[] });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: String((e as any)?.message ?? e) });
  }
});

master.get("/items.csv", (req, res) => {
  try {
    const includeInactive = String(req.query.includeInactive ?? "1") === "1";

    const rows = db
      .prepare(
        `
        SELECT
          id,
          name,
          unit,
          spec,
          temp_zone  AS tempZone,
          is_active  AS isActive,
          stock_unit AS stockUnit,
          stock_conv AS stockConv
        FROM items
        ${includeInactive ? "" : "WHERE is_active = 1"}
        ORDER BY id
        `
      )
      .all() as any[];

    const lines: unknown[][] = [
      ["id", "name", "unit", "spec", "tempZone", "isActive", "stockUnit", "stockConv"],
    ];
    for (const r of rows) {
      lines.push([
        r.id ?? "",
        r.name ?? "",
        r.unit ?? "",
        r.spec ?? "",
        r.tempZone ?? "",
        r.isActive ?? "",
        r.stockUnit ?? "",
        r.stockConv ?? "",
      ]);
    }

    const csv = lines
      .map((row) => row.map((x) => JSON.stringify(String(x ?? ""))).join(","))
      .join("\n");

    sendCsv(res, "items.csv", csv);
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: String((e as any)?.message ?? e) });
  }
});
