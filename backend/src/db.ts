// backend/src/db.ts
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH =
  process.env.DB_PATH ||
  // プロジェクト標準の配置：backend/db/data.sqlite
  path.resolve(__dirname, '../db/data.sqlite');

export const db = new Database(DB_PATH, {

});

// ---- 推奨 PRAGMA ----
db.pragma('foreign_keys = ON');     // 外部キー制約を有効化
db.pragma('journal_mode = WAL');    // 併用アクセスの安定化
db.pragma('synchronous = NORMAL');  // WAL との相性が良い
db.pragma('busy_timeout = 5000');   // ロック待ちタイムアウト（ms）

// 任意・環境に応じて：読み取り主体で少しだけキャッシュ増やしたい場合
// db.pragma('cache_size = -8000');  // 約8MB（KB単位の負数指定）
