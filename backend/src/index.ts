import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { ordering } from './api/ordering';
import { master } from './api/master';
import { shipments } from './api/shipments';
import { inspections } from "./api/inspections";
import { db } from './db';
import { storeShipments } from './api/storeShipments';
import { audit } from './api/audit';  
import { stocks } from "./api/stocks";


const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/master', master);
app.use('/ordering', ordering);
app.use('/', shipments); // /shipments/* と /vendor/shipments/* を内部で面倒見る
app.use("/", inspections);      // ★ 追加（パスは /inspections ...）
app.use('/', storeShipments);
app.use('/audit', audit);
app.use("/stocks", stocks);
// 追加
// 店舗マスタ（発注画面 & 履歴用）
// 役割: { stores: [{ id, code, name }, ...] } を返す
app.get('/stores', (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        id,
        COALESCE(code, id) AS code,
        COALESCE(name, id) AS name
      FROM stores
      WHERE is_active = 1
      ORDER BY id
    `).all();
    res.json({ stores: rows });
  } catch (e: any) {
    console.error('[/stores] error:', e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});
// ベンダーマスタ（発注画面 & 履歴 & 出荷一覧用）
// 役割: { vendors: [{ id, name }, ...] } を返す
app.get('/vendors', (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, name
        FROM vendors
       ORDER BY id
    `).all();
    res.json({ vendors: rows });
  } catch (e: any) {
    console.error('[/vendors] error:', e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
