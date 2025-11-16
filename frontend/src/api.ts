// src/api.ts
export type VendorMode = "all" | "single";


export interface OrderLineDto {
itemId: string;
qty: number; // 小数対応なら number
}
export interface OrderDto {
storeId: string;
vendorMode: VendorMode;
vendorId: string | null; // single のときに使用
orderDate: string; // YYYY-MM-DD（営業日付）
expectedArrivalDate: string; // YYYY-MM-DD
taxRate: number;
lines: OrderLineDto[];
}


// ★モック：実際は fetch でサーバに接続
export async function fetchOrder(params: {
storeId: string;
vendorMode: VendorMode;
vendorId: string | null;
orderDate: string;
}): Promise<OrderDto | null> {
// ここでは localStorage を簡易DBとして利用
const key = buildKey(params);
const raw = localStorage.getItem(key);
if (!raw) return null;
return JSON.parse(raw) as OrderDto;
}


export async function postOrder(dto: OrderDto): Promise<{ serverOrderId: string }> {
const key = buildKey({
storeId: dto.storeId,
vendorMode: dto.vendorMode,
vendorId: dto.vendorId,
orderDate: dto.orderDate,
});
localStorage.setItem(key, JSON.stringify(dto));
return { serverOrderId: `${dto.storeId}-${dto.orderDate}-${dto.vendorId ?? dto.vendorMode}` };
}


export function buildKey(params: {
storeId: string;
vendorMode: VendorMode;
vendorId: string | null;
orderDate: string;
}) {
const { storeId, vendorMode, vendorId, orderDate } = params;
return ["ORDER", storeId, vendorMode, vendorId ?? "-", orderDate].join(":");
}