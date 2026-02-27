"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
// backend/src/db.ts
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const DB_PATH = process.env.DB_PATH ||
    // プロジェクト標準の配置：backend/db/data.sqlite
    path_1.default.resolve(__dirname, '../db/data.sqlite');
exports.db = new better_sqlite3_1.default(DB_PATH, {});
// ---- 推奨 PRAGMA ----
exports.db.pragma('foreign_keys = ON'); // 外部キー制約を有効化
exports.db.pragma('journal_mode = WAL'); // 併用アクセスの安定化
exports.db.pragma('synchronous = NORMAL'); // WAL との相性が良い
exports.db.pragma('busy_timeout = 5000'); // ロック待ちタイムアウト（ms）
// 任意・環境に応じて：読み取り主体で少しだけキャッシュ増やしたい場合
// db.pragma('cache_size = -8000');  // 約8MB（KB単位の負数指定）
