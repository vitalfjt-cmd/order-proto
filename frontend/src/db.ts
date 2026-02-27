// src/db.ts
// 素の IndexedDB を Promise 化して薄くラップ


export type OrderStatus = "draft" | "confirmed";


export interface PersistedOrderDraft {
id: string; // 主キー（storeId|vendorMode|vendorId|requestDate）
// payload: any; // OrderDraft（App.tsx 側の型）
payload: unknown; // 発注ドラフト（画面側で型付けして扱う）
status: OrderStatus; // draft / confirmed
updatedAt: string; // ISO string
}


const DB_NAME = "orderApp";
const DB_VERSION = 1;
const STORE_ORDERS = "orders";


function openDB(): Promise<IDBDatabase> {
return new Promise((resolve, reject) => {
const req = indexedDB.open(DB_NAME, DB_VERSION);
req.onupgradeneeded = () => {
const db = req.result;
if (!db.objectStoreNames.contains(STORE_ORDERS)) {
const store = db.createObjectStore(STORE_ORDERS, { keyPath: "id" });
store.createIndex("byUpdatedAt", "updatedAt", { unique: false });
store.createIndex("byStatus", "status", { unique: false });
}
};
req.onsuccess = () => resolve(req.result);
req.onerror = () => reject(req.error);
});
}


async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T>): Promise<T> {
const db = await openDB();
return new Promise<T>((resolve, reject) => {
const t = db.transaction(STORE_ORDERS, mode);
const store = t.objectStore(STORE_ORDERS);
fn(store).then(resolve).catch(reject);
t.oncomplete = () => db.close();
t.onerror = () => reject(t.error);
t.onabort = () => reject(t.error);
});
}

export async function loadLatestDraftLike(prefix: string): Promise<PersistedOrderDraft | undefined> {
// prefix = storeId|vendorMode|vendorId| までを想定（末尾に "|" を含める）
return tx("readonly", async (store) => {
const all: PersistedOrderDraft[] = await new Promise((resolve, reject) => {
const out: PersistedOrderDraft[] = [];
const req = store.openCursor();
req.onsuccess = (ev) => {
const cursor = (ev.target as IDBRequest).result as IDBCursorWithValue | null;
if (!cursor) return resolve(out);
const val = cursor.value as PersistedOrderDraft;
if (val.id.startsWith(prefix) && val.status === "draft") out.push(val);
cursor.continue();
};
req.onerror = () => reject(req.error);
});
return all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
});
}