// src/utils/csv.ts
export type CsvRow = (string | number | null | undefined)[];
export type CsvOptions = {
  delimiter?: "," | "\t"; // 既定: ","
};

// 1セル分をCSV文字列に変換
function toCsvCell(val: string | number | null | undefined, delimiter: string): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  // 区切り文字・改行・ダブルクォートを含むかどうか
  const needsQuote = s.includes('"') || s.includes("\n") || s.includes("\r") || s.includes(delimiter);
  const escaped = s.replace(/"/g, '""'); // " → ""
  return needsQuote ? `"${escaped}"` : escaped;
}

// rows をCSV文字列化（UTF-8 BOM + CRLF）
export function toCsvString(rows: CsvRow[], opts?: CsvOptions): string {
  const delimiter = opts?.delimiter ?? ",";
  const headerBOM = "\uFEFF"; // Excel 文字化け防止

  const body = rows.map((r) => r.map((val) => toCsvCell(val, delimiter)).join(delimiter)).join("\r\n");
  return headerBOM + body + "\r\n"; // CRLF + BOM
}

// UTF-8 BOM Windows向け
export function downloadCsv(filename: string, csv: string) {
  // 先頭に UTF-8 BOM を付与
  const BOM = "\uFEFF";
  const blob = new Blob([BOM, csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// export function downloadCsv(filename: string, csv: string) {
//   const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
//   const url = URL.createObjectURL(blob);
//   const a = document.createElement("a");
//   a.href = url;
//   a.download = filename;
//   document.body.appendChild(a);
//   a.click();
//   document.body.removeChild(a);
//   URL.revokeObjectURL(url);
// }
