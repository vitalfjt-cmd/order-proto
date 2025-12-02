
import React from "react";
import { InspectionList } from "../inspection/InspectionList";
import type { OwnerType } from "../inspection/inspectionApi";

// DC 用の検品一覧ラッパー
// - ownerType は常に "DC"
// - ownerId に DC のID（例: "DC01"）を渡す想定
type Props = {
  dcId: string;                         // 例: "DC01"
  onEdit: (headerId: string) => void;   // 詳細画面への遷移など
  onBack?: () => void;
};

export function VendorInspectionList({ dcId, onEdit, onBack }: Props) {
  return (
    <InspectionList
      ownerType={"DC" as OwnerType}
      ownerId={dcId}
      onEdit={onEdit}
      onBack={onBack}
    />
  );
}


// // src/vendor/VendorInspectionList.tsx

// import React, { useEffect, useState } from "react";
// import type { InspectionHeader, InspectionLine } from "../inspection/inspectionApi";
// import { downloadCsv } from "../utils/csv";
// import { buildDiscrepancyCsv } from "../inspection/discrepancyCsv";

// // ID 正規化（ゼロ埋め固定長）
// const ID = {
//   vendor: (s: string) => String(s ?? "").replace(/\D/g, "").padStart(6, "0"),
//   store: (s: string) => String(s ?? "").replace(/\D/g, "").padStart(4, "0"),
// };

// type Props = {
//   /** 例: "000011"（空文字なら未指定スタート） */
//   vendorIdDefault: string;
//   onBack?: () => void;
// };

// // InspectionHeader に vendorName / destinationName などが付く可能性を考慮したビュー型
// type HeaderView = InspectionHeader & {
//   vendorName?: string;
//   destinationName?: string;
// };

// // === ひとまずの stub 実装 ===
// // バックエンド/API 側が固まったら、ここを本実装に置き換えます。
// async function searchInspectionsByVendor(params: {
//   from?: string;
//   to?: string;
//   vendorId?: string;
//   destinationId?: string;
// }): Promise<{ headers: InspectionHeader[]; lines: InspectionLine[] }> {
//   console.warn("[VendorInspectionList] searchInspectionsByVendor is not implemented yet.", params);
//   // TODO: /inspections/xxx API ができたらここで fetch する
//   return { headers: [], lines: [] };
// }

// async function unconfirmInspections(ids: (string | number)[]): Promise<void> {
//   console.warn("[VendorInspectionList] unconfirmInspections is not implemented yet.", { ids });
//   // TODO: /inspections/unconfirm API ができたらここで fetch/POST する
// }

// export function VendorInspectionList(props: Props) {
//   const { onBack } = props;
//   const vendorIdDefault = props.vendorIdDefault ?? "";

//   const [from, setFrom] = useState<string>("");
//   const [to, setTo] = useState<string>("");
//   const [vendorId, setVendorId] = useState<string>("");
//   const [destinationId, setDestinationId] = useState<string>("");

//   const [headers, setHeaders] = useState<InspectionHeader[]>([]);
//   const [lines, setLines] = useState<InspectionLine[]>([]);
//   const [selected, setSelected] = useState<Record<string | number, boolean>>({});

//   // マウント時に一度だけ既定値を適用
//   useEffect(() => {
//     setVendorId(vendorIdDefault ?? "");
//   }, []); // eslint-disable-line react-hooks/exhaustive-deps

//   async function doSearch(): Promise<void> {
//     const vendorIdParam =
//       vendorId && vendorId.trim() !== "" ? ID.vendor(vendorId) : undefined;
//     const destParam =
//       destinationId && destinationId.trim() !== ""
//         ? ID.store(destinationId)
//         : undefined;

//     const res = await searchInspectionsByVendor({
//       from: from || undefined,
//       to: to || undefined,
//       vendorId: vendorIdParam,
//       destinationId: destParam,
//     });

//     setHeaders(res.headers);
//     setLines(res.lines);

//     const initSel: Record<string | number, boolean> = {};
//     for (const h of res.headers) initSel[h.id] = false;
//     setSelected(initSel);
//   }

//   // 検収取消（stub）
//   async function handleUnconfirm(): Promise<void> {
//     const ids = headers
//       .filter(h => selected[h.id] && String(h.status) === "confirmed")
//       .map(h => h.id);

//     if (ids.length === 0) {
//       alert("取消対象（confirmed）が選択されていません。");
//       return;
//     }
//     if (!confirm(`${ids.length}件の検収を取り消します。よろしいですか？`)) return;

//     await unconfirmInspections(ids);
//     await doSearch();
//   }

//   // 差異CSV（headerIds は string[] 型を期待しているので文字列に変換）
//   function handleCsv(): void {
//     const selIds = headers.filter(h => selected[h.id]).map(h => String(h.id));
//     const csv = buildDiscrepancyCsv(headers, lines, {
//       headerIds: selIds.length ? selIds : undefined,
//       includeHeader: true,
//       delimiter: ",",
//     });
//     const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
//     const vid = vendorId ? ID.vendor(vendorId) : vendorIdDefault || "ALL";
//     downloadCsv(`vendor_discrepancy_${vid}_${stamp}.csv`, csv);
//   }

//   const headersView = headers as HeaderView[];

//   return (
//     <div className="p-4 space-y-3">
//       <h1 className="text-xl font-bold">検品差異（ベンダー）</h1>

//       <div className="flex flex-wrap items-end gap-3">
//         {onBack && (
//           <button className="border rounded px-3 py-1" onClick={onBack}>
//             ← 戻る
//           </button>
//         )}

//         <label>
//           期間From{" "}
//           <input
//             type="date"
//             value={from}
//             onChange={e => setFrom(e.target.value)}
//             className="border rounded px-2 py-1"
//           />
//         </label>

//         <label>
//           To{" "}
//           <input
//             type="date"
//             value={to}
//             onChange={e => setTo(e.target.value)}
//             className="border rounded px-2 py-1"
//           />
//         </label>

//         <label>
//           ベンダー{" "}
//           <input
//             value={vendorId}
//             onChange={e => setVendorId(e.target.value)}
//             className="border rounded px-2 py-1 w-28"
//           />
//         </label>

//         <label>
//           納品先（任意）
//           <input
//             value={destinationId}
//             onChange={e => setDestinationId(e.target.value)}
//             className="border rounded px-2 py-1 w-28"
//           />
//         </label>

//         <button className="border rounded px-3 py-1" onClick={doSearch}>
//           検索
//         </button>

//         <div className="ml-auto flex items-center gap-3">
//           <button
//             className="border rounded px-3 py-1"
//             onClick={handleCsv}
//             disabled={headers.length === 0}
//           >
//             差異CSV
//           </button>
//           <button
//             className="border rounded px-3 py-1"
//             onClick={handleUnconfirm}
//             disabled={headers.every(
//               h => !(selected[h.id] && String(h.status) === "confirmed"),
//             )}
//           >
//             選択を検収取消
//           </button>
//         </div>
//       </div>

//       {/* 一覧テーブル */}
//       <div style={{ overflow: "auto", maxHeight: "60vh" }}>
//         <table style={{ width: "100%", borderCollapse: "collapse" }}>
//           <thead>
//             <tr>
//               <th
//                 style={{
//                   borderBottom: "1px solid #e2e8f0",
//                   padding: "6px 8px",
//                 }}
//               >
//                 <input
//                   type="checkbox"
//                   onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
//                     const checked = e.target.checked;
//                     const next: Record<string | number, boolean> = {};
//                     for (const h of headers) {
//                       next[h.id] = checked;
//                     }
//                     setSelected(next);
//                   }}
//                   checked={
//                     headers.length > 0 &&
//                     headers.every(h => selected[h.id])
//                   }
//                   aria-label="すべて選択"
//                 />
//               </th>
//               <th
//                 style={{
//                   borderBottom: "1px solid #e2e8f0",
//                   padding: "6px 8px",
//                 }}
//               >
//                 伝票番号
//               </th>
//               <th
//                 style={{
//                   borderBottom: "1px solid #e2e8f0",
//                   padding: "6px 8px",
//                 }}
//               >
//                 納品日
//               </th>
//               <th
//                 style={{
//                   borderBottom: "1px solid #e2e8f0",
//                   padding: "6px 8px",
//                 }}
//               >
//                 ベンダー
//               </th>
//               <th
//                 style={{
//                   borderBottom: "1px solid #e2e8f0",
//                   padding: "6px 8px",
//                 }}
//               >
//                 納品先
//               </th>
//               <th
//                 style={{
//                   borderBottom: "1px solid #e2e8f0",
//                   padding: "6px 8px",
//                 }}
//               >
//                 状態
//               </th>
//             </tr>
//           </thead>
//           <tbody>
//             {headersView.map(h => {
//               const checked = !!selected[h.id];
//               const isConfirmed = String(h.status) === "confirmed";
//               return (
//                 <tr
//                   key={h.id}
//                   className="[&>td]:border-b [&>td]:py-1 [&>td]:px-2"
//                   style={{ opacity: isConfirmed ? 0.85 : 1 }}
//                 >
//                   <td className="w-10 text-center">
//                     <input
//                       type="checkbox"
//                       checked={checked}
//                       onChange={e =>
//                         setSelected(prev => ({
//                           ...prev,
//                           [h.id]: e.target.checked,
//                         }))
//                       }
//                       aria-label={`${h.id} を選択`}
//                     />
//                   </td>

//                   <td className="font-mono text-sm">{h.id}</td>
//                   <td>{h.deliveryDate}</td>
//                   <td>{h.vendorName || h.vendorId}</td>
//                   <td>{h.destinationName || h.destinationId}</td>
//                   <td>{String(h.status)}</td>
//                 </tr>
//               );
//             })}
//             {headers.length === 0 && (
//               <tr>
//                 <td
//                   colSpan={6}
//                   style={{ color: "#64748b", padding: "8px" }}
//                 >
//                   データがありません。
//                 </td>
//               </tr>
//             )}
//           </tbody>
//         </table>
//       </div>
//     </div>
//   );
// }
