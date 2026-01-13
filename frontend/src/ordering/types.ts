// frontend/src/ordering/types.ts

export type OrderListRow = {
  id: string;
  storeId: string;
  vendorId: string | null;
  orderDate: string; // YYYY-MM-DD
  lineCount: number;
  total: number;
};

export type OrderListResponse = {
  total: number;
  items: OrderListRow[];
  summary: { total: number; count: number };
};

export type OrderDetail = {
  header: {
    id: string;
    storeId: string;
    vendorId: string | null;
    orderDate: string;
    expectedArrivalDate: string | null;
    subtotal: number;
    tax: number;
    total: number;
    createdAt?: string | null;
    updatedAt?: string | null;
  };
  lines: {
    itemId: string;
    itemName?: string;
    qty: number;
    unitPrice: number;
    amount: number;
  }[];
};

// ===== ordering/entry =====

export type StoreLite = {
  id: string;
  code?: string;
  name: string;
};

export type VendorLite = {
  id: string;
  name: string;
  cutoffHHmm?: string;
  leadTimeDays?: number;
};

export type OrderingEntryStatus = {
  editable?: boolean;
  reason?: string;
};

export type OrderingRulePerVendor = {
  orderable: boolean;
  cutoffHHmm: string;
  leadTimeDays: number;
};

export type OrderingRules = {
  perVendor?: Record<string, OrderingRulePerVendor>;
};

export type OrderingEntryItem = {
  itemId: string;
  name: string;
  spec?: string;
  unit?: string;
  vendorId: string;
  unitPrice: number;
};

// サーバーが camelCase / snake_case どちらで返しても受けられるようにする
export type OrderingEntryLine =
  | {
      itemId: string;
      qty?: number;
      unitPrice?: number;
      vendorId?: string;
      expectedArrivalDate?: string | null;
    }
  | {
      item_id: string;
      qty?: number;
      unitPrice?: number;
      vendor_id?: string;
      expected_arrival_date?: string | null;
    };

export type OrderingEntryBundle = {
  exists: boolean;
  lines: OrderingEntryLine[];
};

export type OrderingEntryResponse = {
  // 名称マップ（任意）
  storeName?: string;
  vendorNames?: Record<string, string>;
  itemNames?: Record<string, string>;

  // マスタ（任意）
  stores?: StoreLite[];
  vendors?: VendorLite[];

  // ルール（任意）
  rules?: OrderingRules;

  // 画面ロック用（任意）
  status?: OrderingEntryStatus;

  // 明細ソース（どれが来てもOK）
  items?: OrderingEntryItem[];
  mergedLines?: OrderingEntryLine[];
  draft?: OrderingEntryBundle;
  order?: OrderingEntryBundle;
};

// ===== ordering/submit =====

export type OrderingSubmitLine = {
  itemId: string;
  qty: number;
  unitPrice: number;
  vendorId: string;
  expectedArrivalDate?: string | null;
};

export type OrderingSubmitRequest = {
  storeId: string;

  // B案運用に寄せる（App.tsx が送っている想定）
  vendorMode?: "all";
  vendorId?: null;

  orderDate: string;
  expectedArrivalDate?: string | null;
  taxRate?: number | null;

  lines: OrderingSubmitLine[];
};

export type OrderingSubmitResponse = {
  orderId: string;
  totals: { subtotal: number; tax: number; total: number };
};
