"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.initDb = initDb;
// backend/src/db.ts
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const DB_DIR = path_1.default.join(__dirname, "..", "db");
const DB_FILE = path_1.default.join(DB_DIR, "data.sqlite");
const SCHEMA_FILE = path_1.default.join(DB_DIR, "schema.sql");
const SEED_FILE = path_1.default.join(DB_DIR, "seed.sql");
function getDb() {
    if (!fs_1.default.existsSync(DB_DIR))
        fs_1.default.mkdirSync(DB_DIR, { recursive: true });
    const db = new better_sqlite3_1.default(DB_FILE);
    db.pragma("journal_mode = WAL");
    return db;
}
function initDb() {
    const db = getDb();
    // スキーマ適用（IF NOT EXISTS 付きなので安全に毎回実行可）
    const schemaSql = fs_1.default.readFileSync(SCHEMA_FILE, "utf-8");
    db.exec(schemaSql);
    // 初期投入：items が空なら seed を流す
    const row = db.prepare(`SELECT COUNT(*) AS c FROM items`).get();
    if (row.c === 0) {
        const seedSql = fs_1.default.readFileSync(SEED_FILE, "utf-8");
        db.exec(seedSql);
    }
    return db;
}
