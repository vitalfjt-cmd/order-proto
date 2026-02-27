"use strict";
// backend/src/lib/dates.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.nowTimestampJst = exports.ymd = void 0;
const ymd = (d) => {
    const dt = typeof d === 'string' ? new Date(d) : d;
    const z = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${z(dt.getMonth() + 1)}-${z(dt.getDate())}`;
};
exports.ymd = ymd;
// 追記：JST の "YYYY-MM-DD hh:mm:ss" を返すヘルパー
const nowTimestampJst = () => {
    const dt = new Date(); // OS のローカルタイム（JST）前提
    const z = (n) => String(n).padStart(2, '0');
    const y = dt.getFullYear();
    const m = z(dt.getMonth() + 1);
    const d = z(dt.getDate());
    const h = z(dt.getHours());
    const mi = z(dt.getMinutes());
    const s = z(dt.getSeconds());
    return `${y}-${m}-${d} ${h}:${mi}:${s}`;
};
exports.nowTimestampJst = nowTimestampJst;
