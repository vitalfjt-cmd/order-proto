// frontend/src/utils/dateCsv.ts
export type CsvDateStyle = "iso" | "slash";

// 入力が "YYYY-MM-DD" / "YYYY/M/D" / "YYYY/MM/DD" のどれでも ISO に寄せる
export function normalizeIsoDate(s: string | null | undefined): string {
  if (!s) return "";
  const str = String(s).trim();
  const m = str.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (!m) return str; // 想定外はそのまま返す（壊さない）
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export function formatDateForCsv(
  s: string | null | undefined,
  style: CsvDateStyle = "iso"
): string {
  const iso = normalizeIsoDate(s);
  if (!iso) return "";
  if (style === "iso") return iso;

  // Excelで見やすい（ゼロ埋めしない）表記
  const [y, m, d] = iso.split("-");
  return `${y}/${Number(m)}/${Number(d)}`;
}
