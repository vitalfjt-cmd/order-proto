import React, { useEffect, useMemo, useState } from "react";
import { listVendors } from "../vendor/apiVendor";
import type { MasterVendor } from "../vendor/apiVendor";

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
};

export function VendorModal({ open, onClose, onSelect }: Props) {
  const [vendors, setVendors] = useState<MasterVendor[]>([]);
  const [q, setQ] = useState("");

  // モーダルオープン時にベンダー一覧を取得
  useEffect(() => {
    if (!open) return;

    (async () => {
      try {
        const vs = await listVendors();
        setVendors(vs);
      } catch (e) {
        console.error("[VendorModal] listVendors error:", e);
        alert("ベンダー一覧の取得に失敗しました。");
      }
    })();
  }, [open]);

  const filtered = useMemo(() => {
    if (!q) return vendors;
    const keyword = q.trim();
    return vendors.filter(
      (v) =>
        v.id.includes(keyword) || v.name.includes(keyword)
    );
  }, [vendors, q]);


  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        padding: "40px",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "white",
          padding: "20px",
          width: "420px",
          maxHeight: "80vh",
          overflow: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-3">ベンダー選択</h2>

        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ID または 名称で検索"
          className="border rounded px-2 py-1 w-full mb-3"
        />

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {filtered.map((v) => (
              <tr
                key={v.id}
                onClick={() => onSelect(v.id)}
                style={{
                  cursor: "pointer",
                  borderBottom: "1px solid #eee",
                }}
              >
                <td className="px-2 py-1 w-24">{v.id}</td>
                <td className="px-2 py-1">{v.name}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  className="px-2 py-2 text-slate-500"
                  colSpan={2}
                >
                  該当なし
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-3 text-right">
          <button
            className="border rounded px-3 py-1"
            onClick={onClose}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
