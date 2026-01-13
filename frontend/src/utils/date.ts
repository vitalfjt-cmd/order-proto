// frontend/src/utils/date.ts
// 方針：
// - "YYYY-MM-DD" は必ずローカル日付で作る（toISOString は使わない）
// - 既存の関数名は維持（呼び出し側を壊さない）
// - businessDate は 04:00 境界（04:00は前日扱い）を維持

// --- internal helpers ---

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatYmdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * YYYY-MM-DD をローカル0時として Date にする。
 * - new Date("YYYY-MM-DD") は実装によりUTC解釈になることがあるため避ける
 */
function parseYmdToLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

// --- App.tsx 由来：ローカル日付フォーマット（既存名維持） ---
export const formatDateLocal = (d: Date) => formatYmdLocal(d);

// --- business date (04:00 boundary) ---

export function getBusinessDate(now = new Date()): { businessDate: string; isMaintenance: boolean } {
  const h = now.getHours();
  const m = now.getMinutes();

  // 04:00台をメンテ（厳密には04:00～04:59想定）
  // ※元実装の「h===5 && m===0」は 05:00 ちょうどだけメンテになっていたので、
  //   意図どおりなら 04:00～04:59 をメンテ扱いに寄せる。
  const isMaintenance = h === 4;

  // 04:00 までは前日扱い（04:01から当日）
  const ref = new Date(now);
  if (h < 4 || (h === 4 && m === 0)) {
    ref.setDate(ref.getDate() - 1);
  }

  return { businessDate: formatYmdLocal(ref), isMaintenance };
}

// 営業日付の "今日" を常に取りたいとき用（既存名維持）
export function getTodayBusinessYmd(): string {
  return getBusinessDate().businessDate;
}

// --- cutoff helpers ---

export function getCutoffAt(orderDate: string, hhmm: string): Date {
  const [hh, mm] = hhmm.split(":").map((x) => Number(x));

  // orderDate のローカル0時を基点にする（UTC解釈回避）
  const d = parseYmdToLocalDate(orderDate);

  // 翌日に進めてから締め時刻を入れる（例: 翌日 04:00）
  d.setDate(d.getDate() + 1);
  d.setHours(hh || 0, mm || 0, 0, 0);

  return d; // ローカルタイム（ブラウザ）
}

function isFutureBusinessDate(orderDate: string): boolean {
  // 今日のローカル日付（営業日付ではない）
  const todayStr = formatYmdLocal(new Date());
  return orderDate > todayStr;
}

const DEBUG_SAME_DAY_CUTOFF = false;

// 締め超過判定（既存名維持）
export function isPastCutoff(orderDate: string, hhmm: string) {
  if (!orderDate) return false;
  if (isFutureBusinessDate(orderDate)) return false; // 未来日は常に編集OK

  if (DEBUG_SAME_DAY_CUTOFF) {
    // 同日締めのデバッグ（ローカル日付の当日 hh:mm）
    const [hh, mm] = hhmm.split(":").map((x) => Number(x));
    const t = parseYmdToLocalDate(orderDate);
    t.setHours(hh || 0, mm || 0, 0, 0);
    return Date.now() > t.getTime();
  }

  const cutoff = getCutoffAt(orderDate, hhmm);
  return Date.now() > cutoff.getTime();
}

// --- HistoryPage.tsx 由来（既存名維持） ---
export function ymd(d: Date) {
  // 既存の関数名のまま中身をローカル基準に統一
  return formatYmdLocal(d);
}

// --- StoreStockList.tsx 由来（既存名維持） ---
export function todayYmd() {
  // UTC ではなくローカルの日付
  return formatYmdLocal(new Date());
}

// --- VendorShipments.tsx 由来（既存名維持） ---
export function formatYMD(d: Date): string {
  return formatYmdLocal(d);
}

export function formatDateTimeLocal(d: Date): string {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `${y}-${m}-${dd} ${hh}:${mi}:${ss}`;
}
