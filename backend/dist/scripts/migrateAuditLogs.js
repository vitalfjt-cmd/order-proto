"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// backend/src/scripts/migrateAuditLogs.ts
const db_1 = require("../db");
function tableExists(name) {
    const row = db_1.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(name);
    return !!row;
}
function colSet(table) {
    const rows = db_1.db
        .prepare(`SELECT name FROM pragma_table_info(?)`)
        .all(table);
    return new Set(rows.map((r) => r.name));
}
function main() {
    if (!tableExists("audit_logs")) {
        console.log("[migrateAuditLogs] audit_logs not found: nothing to do.");
        return;
    }
    // 1) header_id -> shipment_id（旧スキーマ救済）
    let cols = colSet("audit_logs");
    if (cols.has("header_id") && !cols.has("shipment_id")) {
        console.log("[migrateAuditLogs] RENAME COLUMN header_id -> shipment_id");
        db_1.db.exec(`ALTER TABLE audit_logs RENAME COLUMN header_id TO shipment_id;`);
    }
    // 2) inspection_id 追加（無ければ）
    cols = colSet("audit_logs");
    if (!cols.has("inspection_id")) {
        console.log("[migrateAuditLogs] ADD COLUMN inspection_id");
        db_1.db.exec(`ALTER TABLE audit_logs ADD COLUMN inspection_id TEXT;`);
    }
    // 3) 旧データ補正：
    //    旧 schema の inspection.* は "header_id" に inspectionId が入っていた想定
    //    すでに shipment_id にリネームされているので、inspection.* だけ inspection_id へ移す
    const before = db_1.db
        .prepare(`SELECT COUNT(*) AS c
       FROM audit_logs
       WHERE inspection_id IS NULL
         AND shipment_id IS NOT NULL
         AND type LIKE 'inspection.%'`)
        .get();
    db_1.db.exec(`
    UPDATE audit_logs
       SET inspection_id = shipment_id,
           shipment_id   = NULL
     WHERE inspection_id IS NULL
       AND shipment_id IS NOT NULL
       AND type LIKE 'inspection.%';
  `);
    const after = db_1.db
        .prepare(`SELECT COUNT(*) AS c
       FROM audit_logs
       WHERE inspection_id IS NULL
         AND shipment_id IS NOT NULL
         AND type LIKE 'inspection.%'`)
        .get();
    console.log(`[migrateAuditLogs] moved legacy inspection rows: ${before.c - after.c}`);
    // 4) index（念のため）
    db_1.db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_at              ON audit_logs(at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_shipment_id     ON audit_logs(shipment_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_inspection_id   ON audit_logs(inspection_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_vendor_id       ON audit_logs(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_destination_id  ON audit_logs(destination_id);
  `);
    console.log("[migrateAuditLogs] done.");
}
try {
    main();
}
finally {
    db_1.db.close();
}
