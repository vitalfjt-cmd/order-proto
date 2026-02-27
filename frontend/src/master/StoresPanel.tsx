import { useEffect, useMemo, useState } from "react";
import { listStores, padStoreId, upsertStore, type StoreLite } from "./apiMaster";

export default function StoresPanel() {
  const [loading, setLoading] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(true);

  const [rows, setRows] = useState<StoreLite[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState<0 | 1>(1);

  const sorted = useMemo(() => [...rows].sort((a, b) => a.id.localeCompare(b.id)), [rows]);

  async function reload() {
    setLoading(true);
    try {
      const r = await listStores({ includeInactive });
      setRows(r ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, [includeInactive]);

  function startNew() {
    setSelectedId("");
    setId("");
    setName("");
    setIsActive(1);
  }

  function pick(s: StoreLite) {
    setSelectedId(s.id);
    setId(s.id);
    setName(s.name ?? "");
    setIsActive((s.isActive ?? 1) as 0 | 1);
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
    const sid = padStoreId(id);
    if (!sid || !name.trim()) {
        alert("storeId(4桁) と name は必須です");
        return;
    }
    setLoading(true);
    try {
        await upsertStore({ id: sid, name: name.trim(), isActive });
        await reload();
        setSelectedId(sid);
        alert("保存しました");
    } catch (e: unknown) {
        alert(errorMessage(e));
    } finally {
        setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <button type="button" className="border rounded px-3 py-1" onClick={reload} disabled={loading}>
          再読込
        </button>
        <button type="button" className="border rounded px-3 py-1" onClick={startNew} disabled={loading}>
          新規
        </button>

        <label className="text-sm flex gap-2 items-center">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          非稼働も表示
        </label>

        <div className="text-xs text-gray-600">※ IDは4桁ゼロ埋め（例: 0002）</div>
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
                  <th className="py-1 pl-2">active</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr
                    key={s.id}
                    className={`border-b cursor-pointer ${selectedId === s.id ? "bg-gray-50" : ""}`}
                    onClick={() => pick(s)}
                  >
                    <td className="py-1 pr-2 font-mono">{s.id}</td>
                    <td className="py-1">{s.name}</td>
                    <td className="py-1 pl-2 font-mono">{(s.isActive ?? 1) === 1 ? "1" : "0"}</td>
                  </tr>
                ))}
                {!sorted.length && (
                  <tr>
                    <td className="py-2 text-gray-500" colSpan={3}>データなし</td>
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
              storeId（4桁）
              <input
                className="border rounded px-3 py-1 w-full font-mono"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="0002"
              />
            </label>

            <label className="text-sm block">
              name
              <input
                className="border rounded px-3 py-1 w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="店舗名"
              />
            </label>

            <label className="text-sm block">
              isActive（0/1）
              <select
                className="border rounded px-3 py-1 w-full"
                value={String(isActive)}
                onChange={(e) => setIsActive(e.target.value === "0" ? 0 : 1)}
              >
                <option value="1">1（稼働）</option>
                <option value="0">0（非稼働）</option>
              </select>
            </label>

            <div className="flex gap-2">
              <button type="button" className="border rounded px-3 py-1" onClick={onSave} disabled={loading}>
                保存
              </button>
              <div className="text-xs text-gray-600 self-center">
                ※ 削除はせず、稼働(0/1)で制御
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
