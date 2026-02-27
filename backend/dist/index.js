"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const ordering_1 = require("./api/ordering");
const master_1 = require("./api/master");
const shipments_1 = require("./api/shipments");
const inspections_1 = require("./api/inspections");
const db_1 = require("./db");
const storeShipments_1 = require("./api/storeShipments");
const audit_1 = require("./api/audit");
const stocks_1 = require("./api/stocks");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '2mb' }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/master', master_1.master);
app.use('/ordering', ordering_1.ordering);
app.use('/', shipments_1.shipments); // /shipments/* と /vendor/shipments/* を内部で面倒見る
app.use("/", inspections_1.inspections); // ★ 追加（パスは /inspections ...）
app.use('/', storeShipments_1.storeShipments);
app.use('/audit', audit_1.audit);
app.use("/stocks", stocks_1.stocks);
app.use("/master", master_1.master);
// 追加
// 店舗マスタ（発注画面 & 履歴用）
// 役割: { stores: [{ id, code, name }, ...] } を返す
app.get('/stores', (_req, res) => {
    try {
        const rows = db_1.db.prepare(`
      SELECT
        id,
        COALESCE(code, id) AS code,
        COALESCE(name, id) AS name
      FROM stores
      WHERE is_active = 1
      ORDER BY id
    `).all();
        res.json({ stores: rows });
    }
    catch (e) {
        console.error('[/stores] error:', e);
        res.status(500).json({ error: String(e?.message ?? e) });
    }
});
// ベンダーマスタ（発注画面 & 履歴 & 出荷一覧用）
// 役割: { vendors: [{ id, name }, ...] } を返す
app.get('/vendors', (_req, res) => {
    try {
        const rows = db_1.db.prepare(`
      SELECT id, name
        FROM vendors
       ORDER BY id
    `).all();
        res.json({ vendors: rows });
    }
    catch (e) {
        console.error('[/vendors] error:', e);
        res.status(500).json({ error: String(e?.message ?? e) });
    }
});
const PORT = Number(process.env.PORT || 8080);
app.listen(PORT);
