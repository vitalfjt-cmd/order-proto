// src/inspection/inspectionApi.ts
import type { VendorOrderHeader, VendorOrderLine } from "../vendor/apiVendor";

// ====== 型 ======
export type OwnerType = "STORE" | "DC";

export interface InspectionHeader {
  id: string;                   // INSP-<yyyymmdd>-<vendor>-<dest>-<seq>
  sourceShipmentId: string;     // VendorOrderHeader.id
  vendorId: string;
  deliveryDate: string;
  destinationId: string;
  destinationName?: string;
  ownerType: OwnerType;         // STORE or DC（= 納品先の種別）
  ownerId: string;              // = destinationId
  status: "open" | "confirmed"; // 検収前/検収済
  createdAt: string;
  updatedAt: string;
}
export interface InspectionLine {
  lineId: string;
  headerId: string;             // InspectionHeader.id
  itemId: string;
  itemName: string;
  unit: string;
  shipQty: number;              // 出荷数（参照）
  inspectQty: number;           // 検品数（編集）
  lotNo?: string;
  note?: string;
}

// ====== localStorage キー ======
const IH = (id: string) => `INSH:${id}`;
const IL = (hid: string) => `INSL:${hid}`;

// ====== 検索 ======
export async function searchInspections(params: {
  from?: string; to?: string;           // YYYY-MM-DD
  vendorId?: string;
  ownerType: OwnerType;
  ownerId: string;
}) : Promise<{ headers: InspectionHeader[], lines: InspectionLine[] }> {
  const out: { headers: InspectionHeader[], lines: InspectionLine[] } = { headers: [], lines: [] };
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (!k.startsWith("INSH:")) continue;
    const h = JSON.parse(localStorage.getItem(k)!) as InspectionHeader;
    if (h.ownerType !== params.ownerType || h.ownerId !== params.ownerId) continue;
    if (params.vendorId && h.vendorId !== params.vendorId) continue;
    if (params.from && h.deliveryDate < params.from) continue;
    if (params.to && h.deliveryDate > params.to) continue;
    out.headers.push(h);
    const lr = localStorage.getItem(IL(h.id));
    if (lr) out.lines.push(...(JSON.parse(lr) as InspectionLine[]));
  }
  return out;
}

// ====== 1件取得 ======
export async function getInspection(headerId: string): Promise<{ header: InspectionHeader | null, lines: InspectionLine[] }> {
  const raw = localStorage.getItem(IH(headerId));
  if (!raw) return { header: null, lines: [] };
  const header = JSON.parse(raw) as InspectionHeader;
  const lr = localStorage.getItem(IL(headerId));
  const lines = lr ? (JSON.parse(lr) as InspectionLine[]) : [];
  return { header, lines };
}

// ====== 行保存 ======
export async function saveInspectionLines(
  headerId: string,
  patches: Array<Pick<InspectionLine, "lineId" | "inspectQty" | "lotNo" | "note">>
): Promise<void> {
  const key = IL(headerId);
  const lr = localStorage.getItem(key);
  if (!lr) return;
  const arr = JSON.parse(lr) as InspectionLine[];
  const map = new Map(arr.map(x => [x.lineId, x]));
  for (const p of patches) {
    const cur = map.get(p.lineId);
    if (cur) {
      cur.inspectQty = Number(p.inspectQty ?? 0);
      if (p.lotNo !== undefined) cur.lotNo = p.lotNo;
      if (p.note !== undefined) cur.note = p.note;
    }
  }
  localStorage.setItem(key, JSON.stringify(Array.from(map.values())));
}

// ====== 一括検収（確定） ======
export async function confirmInspections(headerIds: string[]): Promise<{ confirmedAt: string }> {
  const now = new Date().toISOString();
  for (const hid of headerIds) {
    const hk = IH(hid);
    const raw = localStorage.getItem(hk);
    if (!raw) continue;
    const h = JSON.parse(raw) as InspectionHeader;
    h.status = "confirmed";
    h.updatedAt = now;
    localStorage.setItem(hk, JSON.stringify(h));
  }
  return { confirmedAt: now };
}

// ====== 出荷→検品の自動生成（ベンダー確定時） ======
/**
 * VendorShipments.handleConfirm から呼ぶ。
 * - 伝票ごとに InspectionHeader が未存在なら作成
 * - InspectionLine を出荷明細から生成（inspectQty 初期値 = shipQty）
 * - ownerType/ownerId は納品先の種別/ID（STORE/DC）
 */
export async function ensureFromShipments(
  headers: VendorOrderHeader[],
  lines: VendorOrderLine[],
  targetHeaderIds: string[]
): Promise<void> {
  const hMap = new Map(headers.map(h => [h.id, h]));
  const byH: Map<string, VendorOrderLine[]> = new Map();
  for (const ln of lines) {
    if (!targetHeaderIds.includes(ln.headerId)) continue;
    if (!byH.has(ln.headerId)) byH.set(ln.headerId, []);
    byH.get(ln.headerId)!.push(ln);
  }

  for (const hid of targetHeaderIds) {
    const sh = hMap.get(hid);
    if (!sh) continue;

    // 既に検品ヘッダがあればスキップ
    const exist = findInspectionIdBySource(hid);
    const inspectionId = exist ?? buildInspectionId(sh);
    if (!exist) {
      const ih: InspectionHeader = {
        id: inspectionId,
        sourceShipmentId: sh.id,
        vendorId: sh.vendorId,
        deliveryDate: sh.deliveryDate,
        destinationId: sh.destinationId,
        destinationName: sh.destinationName,
        ownerType: sh.destinationType as OwnerType, // STORE or DC
        ownerId: sh.destinationId,
        status: "open",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(IH(inspectionId), JSON.stringify(ih));
    }

    // 行を投入（未存在なら）
    const linesKey = IL(inspectionId);
    const cur = localStorage.getItem(linesKey);
    if (!cur) {
      const src = byH.get(hid) ?? [];
      const insLines: InspectionLine[] = src.map((l, idx) => ({
        lineId: `INSL-${String(idx + 1).padStart(3, "0")}`,
        headerId: inspectionId,
        itemId: l.itemId,
        itemName: l.itemName,
        unit: l.unit,
        shipQty: Number(l.shipQty ?? l.orderedQty ?? 0),
        inspectQty: Number(l.shipQty ?? l.orderedQty ?? 0),
        lotNo: l.lotNo,
        note: "",
      }));
      localStorage.setItem(linesKey, JSON.stringify(insLines));
    }
  }
}

// ====== 内部 util ======
function buildInspectionId(sh: VendorOrderHeader): string {
  // 伝票単位で一意：INSP-<date>-<vendor>-<dest>
  return `INSP-${sh.deliveryDate}-${sh.vendorId}-${sh.destinationId}`;
}
function findInspectionIdBySource(sourceShipmentId: string): string | null {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (!k.startsWith("INSH:")) continue;
    const h = JSON.parse(localStorage.getItem(k)!) as InspectionHeader;
    if (h.sourceShipmentId === sourceShipmentId) return h.id;
  }
  return null;
}

// ベンダー向け検索（owner 無しで vendorId と期間で絞る）
export async function searchInspectionsByVendor(params: {
  from?: string; to?: string;       // YYYY-MM-DD
  vendorId: string;                 // 必須
  destinationId?: string;           // 任意（店舗/DCを絞る）
}): Promise<{ headers: InspectionHeader[], lines: InspectionLine[] }> {
  const out: { headers: InspectionHeader[], lines: InspectionLine[] } = { headers: [], lines: [] };
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (!k.startsWith("INSH:")) continue;
    const h = JSON.parse(localStorage.getItem(k)!) as InspectionHeader;
    if (h.vendorId !== params.vendorId) continue;
    if (params.destinationId && h.destinationId !== params.destinationId) continue;
    if (params.from && h.deliveryDate < params.from) continue;
    if (params.to && h.deliveryDate > params.to) continue;
    out.headers.push(h);
    const lr = localStorage.getItem(IL(h.id));
    if (lr) out.lines.push(...(JSON.parse(lr) as InspectionLine[]));
  }
  return out;
}

// 検収確定の取り消し（confirmed → open）
export async function unconfirmInspections(headerIds: string[]): Promise<{ unconfirmedAt: string }> {
  const now = new Date().toISOString();
  for (const hid of headerIds) {
    const hk = IH(hid);
    const raw = localStorage.getItem(hk);
    if (!raw) continue;
    const h = JSON.parse(raw) as InspectionHeader;
    h.status = "open";
    h.updatedAt = now;
    localStorage.setItem(hk, JSON.stringify(h));
  }
  return { unconfirmedAt: now };
}
