import { useEffect, useMemo, useState } from "react";
import { listVendors, padVendorId, upsertVendor, type VendorLite } from "./apiMaster";

export default function VendorsPanel() {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<VendorLite[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  const [id, setId] = useState("");
  const [name, setName] = useState("");

  const sorted = useMemo(() => [...rows].sort((a, b) => a.id.localeCompare(b.id)), [rows]);

  async function reload() {
    setLoading(true);
    try {
      const r = await listVendors();
      setRows(r ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  function startNew() {
    setSelectedId("");
    setId("");
    setName("");
  }

  function pick(v: VendorLite) {
    setSelectedId(v.id);
    setId(v.id);
    setName(v.name ?? "");
  }

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

async function onSave() {
  const vid = padVendorId(id);
  if (!vid || !name.trim()) {
    alert("vendorId(6桁) と name は必須です");
    return;
  }
  setLoading(true);
  try {
    await upsertVendor({ id: vid, name: name.trim() });
    await reload();
    setSelectedId(vid);
    alert("保存しました");
  } catch (e: unknown) {
    alert(errorMessage(e));
  } finally {
    setLoading(false);
  }
}

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <button type="button" className="border rounded px-3 py-1" onClick={reload} disabled={loading}>
          再読込
        </button>
        <button type="button" className="border rounded px-3 py-1" onClick={startNew} disabled={loading}>
          新規
        </button>
        <div className="text-xs text-gray-600">※ IDは6桁ゼロ埋め（例: 100011）</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* list */}
        <div className="border rounded p-3">
          <div className="font-semibold mb-2">一覧</div>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-1 pr-2">id</th>
                  <th className="py-1">name</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((v) => (
                  <tr
                    key={v.id}
                    className={`border-b cursor-pointer ${selectedId === v.id ? "bg-gray-50" : ""}`}
                    onClick={() => pick(v)}
                  >
                    <td className="py-1 pr-2 font-mono">{v.id}</td>
                    <td className="py-1">{v.name}</td>
                  </tr>
                ))}
                {!sorted.length && (
                  <tr>
                    <td className="py-2 text-gray-500" colSpan={2}>データなし</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* edit */}
        <div className="border rounded p-3">
          <div className="font-semibold mb-2">登録/更新</div>

          <div className="space-y-2">
            <label className="text-sm block">
              vendorId（6桁）
              <input
                className="border rounded px-3 py-1 w-full font-mono"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="100011"
              />
            </label>

            <label className="text-sm block">
              name
              <input
                className="border rounded px-3 py-1 w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ベンダー名"
              />
            </label>

            <div className="flex gap-2">
              <button type="button" className="border rounded px-3 py-1" onClick={onSave} disabled={loading}>
                保存
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
