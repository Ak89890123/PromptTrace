/**
 * IndexedDB wrapper. Version 1 schema creates all stores + indexes.
 * Future schema changes bump DB_VERSION and add steps in `migrate`.
 */

export const DB_NAME = 'prompttrace';
export const DB_VERSION = 1;

export const STORES = {
  recordCategories: 'recordCategories',
  modelPresets: 'modelPresets',
  libraryRecords: 'libraryRecords',
  assets: 'assets',
  fileRecords: 'fileRecords',
  tags: 'tags',
  exportRecords: 'exportRecords',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

function migrate(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    const categories = db.createObjectStore(STORES.recordCategories, { keyPath: 'id' });
    categories.createIndex('parentId', 'parentId');
    categories.createIndex('isActive', 'isActive');
    categories.createIndex('sortOrder', 'sortOrder');

    const presets = db.createObjectStore(STORES.modelPresets, { keyPath: 'id' });
    presets.createIndex('categoryId', 'categoryId');
    presets.createIndex('isActive', 'isActive');
    presets.createIndex('sortOrder', 'sortOrder');

    const records = db.createObjectStore(STORES.libraryRecords, { keyPath: 'id' });
    records.createIndex('categoryId', 'categoryId');
    records.createIndex('modelPresetId', 'modelPresetId');
    records.createIndex('createdAt', 'createdAt');
    records.createIndex('updatedAt', 'updatedAt');

    const assets = db.createObjectStore(STORES.assets, { keyPath: 'id' });
    assets.createIndex('recordId', 'recordId');
    assets.createIndex('assetType', 'assetType');
    assets.createIndex('role', 'role');
    assets.createIndex('capturedAt', 'capturedAt');

    const files = db.createObjectStore(STORES.fileRecords, { keyPath: 'id' });
    files.createIndex('assetId', 'assetId');
    files.createIndex('downloadId', 'downloadId');
    files.createIndex('downloadStatus', 'downloadStatus');
    files.createIndex('deleteStatus', 'deleteStatus');

    const tags = db.createObjectStore(STORES.tags, { keyPath: 'id' });
    tags.createIndex('recordId', 'recordId');
    tags.createIndex('name', 'name');

    const exports = db.createObjectStore(STORES.exportRecords, { keyPath: 'id' });
    exports.createIndex('recordId', 'recordId');
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => migrate(req.result, e.oldVersion);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Test helper: reset the cached connection (used with fake-indexeddb). */
export function resetDbCache(): void {
  dbPromise = null;
}

export function tx<T>(
  db: IDBDatabase,
  storeNames: StoreName | StoreName[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, mode);
    let result: T;
    Promise.resolve(fn(transaction)).then((r) => {
      result = r;
    }, reject);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('transaction aborted'));
  });
}

export function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
