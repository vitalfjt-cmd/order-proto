// backend/src/lib/dates.ts

export const ymd = (d: Date | string) => {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const z = (n: number) => String(n).padStart(2,'0');
  return `${dt.getFullYear()}-${z(dt.getMonth()+1)}-${z(dt.getDate())}`;
};

// 追記：JST の "YYYY-MM-DD hh:mm:ss" を返すヘルパー
export const nowTimestampJst = () => {
  const dt = new Date();                 // OS のローカルタイム（JST）前提
  const z = (n: number) => String(n).padStart(2, '0');
  const y = dt.getFullYear();
  const m = z(dt.getMonth() + 1);
  const d = z(dt.getDate());
  const h = z(dt.getHours());
  const mi = z(dt.getMinutes());
  const s = z(dt.getSeconds());
  return `${y}-${m}-${d} ${h}:${mi}:${s}`;
};
