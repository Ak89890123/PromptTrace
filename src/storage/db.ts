/**
 * IndexedDB wrapper. Version 2 adds the durable preview-state index.
 * Future schema changes bump DB_VERSION and add steps in `migrate`.
 */

export const DB_NAME = 'promptrace';
export const LEGACY_DB_NAME = 'prompttrace';
export const DB_VERSION = 2;

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
const STORE_NAMES = Object.values(STORES) as StoreName[];

function migrate(db: IDBDatabase, oldVersion: number, upgradeTransaction?: IDBTransaction | null): void {
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
  if (oldVersion < 2) {
    if (upgradeTransaction && db.objectStoreNames.contains(STORES.assets)) {
      const assets = upgradeTransaction.objectStore(STORES.assets);
      if (!assets.indexNames.contains('previewStatus')) assets.createIndex('previewStatus', 'previewStatus');
    }
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;
let legacyMigrationPromise: Promise<void> | null = null;

export function openDb(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => migrate(req.result, e.oldVersion, req.transaction);
    req.onsuccess = () => {
      const db = req.result;
      migrateLegacyDb(factory, db).then(() => resolve(db), reject);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Test helper: reset the cached connection (used with fake-indexeddb). */
export function resetDbCache(): void {
  dbPromise = null;
  legacyMigrationPromise = null;
}

async function migrateLegacyDb(factory: IDBFactory, targetDb: IDBDatabase): Promise<void> {
  if (!legacyMigrationPromise) legacyMigrationPromise = copyLegacyDb(factory, targetDb);
  return legacyMigrationPromise;
}

async function copyLegacyDb(factory: IDBFactory, targetDb: IDBDatabase): Promise<void> {
  const hasTargetData = await hasAnyStoreData(targetDb);
  if (hasTargetData) return;

  const legacyDb = await openRawDb(factory, LEGACY_DB_NAME);
  try {
    const hasLegacyData = await hasAnyStoreData(legacyDb);
    if (!hasLegacyData) return;

    const legacyData = new Map<StoreName, unknown[]>();
    await tx(legacyDb, STORE_NAMES, 'readonly', async (transaction) => {
      await Promise.all(
        STORE_NAMES.map(async (store) => {
          if (!legacyDb.objectStoreNames.contains(store)) {
            legacyData.set(store, []);
            return;
          }
          legacyData.set(store, await reqAsPromise(transaction.objectStore(store).getAll()));
        }),
      );
    });

    await tx(targetDb, STORE_NAMES, 'readwrite', async (transaction) => {
      await Promise.all(
        STORE_NAMES.flatMap((store) =>
          (legacyData.get(store) ?? []).map((item) => reqAsPromise(transaction.objectStore(store).put(item))),
        ),
      );
    });
  } finally {
    legacyDb.close();
  }
}

function openRawDb(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = (e) => migrate(req.result, e.oldVersion, req.transaction);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function hasAnyStoreData(db: IDBDatabase): Promise<boolean> {
  return tx(db, STORE_NAMES, 'readonly', async (transaction) => {
    for (const store of STORE_NAMES) {
      if (!db.objectStoreNames.contains(store)) continue;
      const count = await reqAsPromise(transaction.objectStore(store).count());
      if (count > 0) return true;
    }
    return false;
  });
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
