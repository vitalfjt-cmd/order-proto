// src/slips/slipsApi.ts
import type { InspectionHeader, InspectionLine } from "../inspection/inspectionApi";

export type SlipType = "RED" | "BLACK";
export interface AdjustmentSlip {
  id: string;                // SLIP-<date>-<vendor>-<dest>-<type>
  type: SlipType;            // RED:不足, BLACK:過入
  vendorId: string;
  deliveryDate: string;
  destinationId: string;
  destinationName?: string;
  lines: Array<{
    itemId: string;
    itemName: string;
    unit: string;
    qty: number;             // 絶対値（正数）
    note?: string;
  }>;
  createdAt: string;
}

export function buildSlipsFromInspections(
  headers: InspectionHeader[],
  lines: InspectionLine[],
  scope?: { headerIds?: string[] }
): AdjustmentSlip[] {
  const allow = scope?.headerIds ? new Set(scope.headerIds) : null;
  const hMap = new Map(headers.map(h => [h.id, h]));

  // key: deliveryDate|vendorId|destinationId|type
  type Key = string;
  const buckets = new Map<Key, Map<string, { itemId:string; itemName:string; unit:string; qty:number }>>();

  for (const l of lines) {
    const h = hMap.get(l.headerId);
    if (!h) continue;
    if (allow && !allow.has(h.id)) continue;

    const diff = Number(l.inspectQty || 0) - Number(l.shipQty || 0);
    if (diff === 0) continue;

    const type: SlipType = diff < 0 ? "RED" : "BLACK";
    const key: Key = [h.deliveryDate, h.vendorId, h.destinationId, type].join("|");
    if (!buckets.has(key)) buckets.set(key, new Map());

    const itemKey = l.itemId;
    const absQty = Math.abs(diff);
    const b = buckets.get(key)!;
    if (!b.has(itemKey)) {
      b.set(itemKey, { itemId: l.itemId, itemName: l.itemName, unit: l.unit, qty: 0 });
    }
    b.get(itemKey)!.qty += absQty;
  }

  const out: AdjustmentSlip[] = [];
  for (const [key, itemMap] of buckets) {
    const [deliveryDate, vendorId, destinationId, typeStr] = key.split("|");
    const sampleHeader = headers.find(h => h.deliveryDate === deliveryDate && h.vendorId === vendorId && h.destinationId === destinationId);
    const id = `SLIP-${deliveryDate}-${vendorId}-${destinationId}-${typeStr}`;
    out.push({
      id,
      type: typeStr as SlipType,
      vendorId,
      deliveryDate,
      destinationId,
      destinationName: sampleHeader?.destinationName,
      lines: Array.from(itemMap.values()),
      createdAt: new Date().toISOString(),
    });
  }
  return out;
}
