import type {
  Asset,
  ExportRecordEntry,
  FileRecord,
  LibraryRecord,
  RecordCategory,
  Tag,
} from '../core/domain/entities';
import { openDb, reqAsPromise, STORES, tx, type StoreName } from './db';

async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  return tx(db, store, 'readonly', (t) => reqAsPromise(t.objectStore(store).getAll() as IDBRequest<T[]>));
}

async function getOne<T>(store: StoreName, id: string): Promise<T | undefined> {
  const db = await openDb();
  return tx(db, store, 'readonly', (t) => reqAsPromise(t.objectStore(store).get(id) as IDBRequest<T | undefined>));
}

async function put<T>(store: StoreName, value: T): Promise<T> {
  const db = await openDb();
  await tx(db, store, 'readwrite', (t) => reqAsPromise(t.objectStore(store).put(value)));
  return value;
}

async function remove(store: StoreName, id: string): Promise<void> {
  const db = await openDb();
  await tx(db, store, 'readwrite', (t) => reqAsPromise(t.objectStore(store).delete(id)));
}

async function getByIndex<T>(store: StoreName, index: string, value: IDBValidKey): Promise<T[]> {
  const db = await openDb();
  return tx(db, store, 'readonly', (t) =>
    reqAsPromise(t.objectStore(store).index(index).getAll(value) as IDBRequest<T[]>),
  );
}

export const categoryRepository = {
  list: () => getAll<RecordCategory>(STORES.recordCategories),
  get: (id: string) => getOne<RecordCategory>(STORES.recordCategories, id),
  save: (c: RecordCategory) => put(STORES.recordCategories, c),
  delete: (id: string) => remove(STORES.recordCategories, id),
  children: (parentId: string) => getByIndex<RecordCategory>(STORES.recordCategories, 'parentId', parentId),
};

export const recordRepository = {
  list: () => getAll<LibraryRecord>(STORES.libraryRecords),
  get: (id: string) => getOne<LibraryRecord>(STORES.libraryRecords, id),
  save: (r: LibraryRecord) => put(STORES.libraryRecords, r),
  delete: (id: string) => remove(STORES.libraryRecords, id),
};

export const assetRepository = {
  list: () => getAll<Asset>(STORES.assets),
  get: (id: string) => getOne<Asset>(STORES.assets, id),
  save: (a: Asset) => put(STORES.assets, a),
  delete: (id: string) => remove(STORES.assets, id),
  byRecord: (recordId: string) => getByIndex<Asset>(STORES.assets, 'recordId', recordId),
};

export const fileRecordRepository = {
  list: () => getAll<FileRecord>(STORES.fileRecords),
  get: (id: string) => getOne<FileRecord>(STORES.fileRecords, id),
  save: (f: FileRecord) => put(STORES.fileRecords, f),
  delete: (id: string) => remove(STORES.fileRecords, id),
  byAsset: (assetId: string) => getByIndex<FileRecord>(STORES.fileRecords, 'assetId', assetId),
  byDownloadId: (downloadId: number) =>
    getByIndex<FileRecord>(STORES.fileRecords, 'downloadId', downloadId),
};

export const tagRepository = {
  list: () => getAll<Tag>(STORES.tags),
  save: (t: Tag) => put(STORES.tags, t),
  delete: (id: string) => remove(STORES.tags, id),
  byRecord: (recordId: string) => getByIndex<Tag>(STORES.tags, 'recordId', recordId),
};

export const exportRecordRepository = {
  list: () => getAll<ExportRecordEntry>(STORES.exportRecords),
  save: (e: ExportRecordEntry) => put(STORES.exportRecords, e),
};

/** Delete a record and its assets / file records / tags. Returns the file records that existed. */
export async function deleteRecordCascade(recordId: string): Promise<FileRecord[]> {
  const assets = await assetRepository.byRecord(recordId);
  const fileRecords: FileRecord[] = [];
  for (const asset of assets) {
    fileRecords.push(...(await fileRecordRepository.byAsset(asset.id)));
  }
  const tags = await tagRepository.byRecord(recordId);
  const db = await openDb();
  await tx(
    db,
    [STORES.libraryRecords, STORES.assets, STORES.fileRecords, STORES.tags],
    'readwrite',
    async (t) => {
      t.objectStore(STORES.libraryRecords).delete(recordId);
      for (const a of assets) t.objectStore(STORES.assets).delete(a.id);
      for (const f of fileRecords) t.objectStore(STORES.fileRecords).delete(f.id);
      for (const g of tags) t.objectStore(STORES.tags).delete(g.id);
    },
  );
  return fileRecords;
}
