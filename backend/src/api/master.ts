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
        i.id,
        i.name,
        i.spec,
        i.unit,
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
