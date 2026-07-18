import type {
  Asset,
  ExportRecordEntry,
  FileRecord,
  LibraryRecord,
  RecordCategory,
  Tag,
} from '../core/domain/entities';
import type { PreviewStatus } from '../core/domain/enums';
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

export function isRecordTrashed(record: LibraryRecord): boolean {
  return Boolean(record.trashedAt);
}

export const recordRepository = {
  list: () => getAll<LibraryRecord>(STORES.libraryRecords),
  listActive: async () => (await getAll<LibraryRecord>(STORES.libraryRecords)).filter((record) => !isRecordTrashed(record)),
  listTrashed: async () => (await getAll<LibraryRecord>(STORES.libraryRecords)).filter(isRecordTrashed),
  get: (id: string) => getOne<LibraryRecord>(STORES.libraryRecords, id),
  save: (r: LibraryRecord) => put(STORES.libraryRecords, r),
  delete: (id: string) => remove(STORES.libraryRecords, id),
  trash: async (id: string, trashedAt = new Date().toISOString()) => {
    const record = await getOne<LibraryRecord>(STORES.libraryRecords, id);
    if (!record) return undefined;
    const next = { ...record, trashedAt, updatedAt: trashedAt };
    await put(STORES.libraryRecords, next);
    return next;
  },
  restore: async (id: string) => {
    const record = await getOne<LibraryRecord>(STORES.libraryRecords, id);
    if (!record) return undefined;
    const { trashedAt: _trashedAt, ...restored } = record;
    const next = { ...restored, updatedAt: new Date().toISOString() };
    await put(STORES.libraryRecords, next);
    return next;
  },
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

/** Persist a newly captured record and all of its assets as one atomic unit. */
export async function commitRecordAndAssets(record: LibraryRecord, assets: Asset[]): Promise<void> {
  const db = await openDb();
  await tx(db, [STORES.libraryRecords, STORES.assets], 'readwrite', (transaction) => {
    transaction.objectStore(STORES.libraryRecords).add(record);
    for (const asset of assets) transaction.objectStore(STORES.assets).add(asset);
  });
}

const PREVIEW_LEASE_MS = 60_000;

export type PreviewJobClaim = {
  asset: Asset;
  claimToken: string;
};

function leaseExpired(value: string | undefined, now: string): boolean {
  return !value || value <= now;
}

function claimablePreview(asset: Asset, now: string): boolean {
  if (asset.assetType === 'text' || !asset.originalUrl || asset.previewRef) return false;
  if (asset.previewStatus === 'pending') return true;
  return asset.previewStatus === 'processing' && leaseExpired(asset.previewLeaseUntil, now);
}

/** Claim one pending/expired preview job using an IndexedDB write transaction. */
export async function claimNextPreviewJob(now = new Date()): Promise<PreviewJobClaim | undefined> {
  const db = await openDb();
  const nowIso = now.toISOString();
  let claim: PreviewJobClaim | undefined;
  await tx(db, STORES.assets, 'readwrite', (transaction) => {
    const store = transaction.objectStore(STORES.assets);
    const request = store.getAll();
    request.onsuccess = () => {
      const asset = (request.result as Asset[]).find((candidate) => claimablePreview(candidate, nowIso));
      if (!asset) return;
      const claimToken = crypto.randomUUID();
      const updated: Asset = {
        ...asset,
        previewStatus: 'processing',
        previewClaimToken: claimToken,
        previewLeaseUntil: new Date(now.getTime() + PREVIEW_LEASE_MS).toISOString(),
        previewUpdatedAt: nowIso,
        previewAttemptCount: (asset.previewAttemptCount ?? 0) + 1,
      };
      store.put(updated);
      claim = { asset: updated, claimToken };
    };
  });
  return claim;
}

async function finishPreviewJob(
  assetId: string,
  claimToken: string,
  result: { status: PreviewStatus; previewRef?: string; errorCode?: string },
  now = new Date(),
): Promise<boolean> {
  const db = await openDb();
  const nowIso = now.toISOString();
  let finished = false;
  await tx(db, STORES.assets, 'readwrite', (transaction) => {
    const store = transaction.objectStore(STORES.assets);
    const request = store.get(assetId);
    request.onsuccess = () => {
      const asset = request.result as Asset | undefined;
      if (!asset) return;
      // A stale worker can never overwrite a newer claimant. A ready asset
      // is also an idempotent terminal success.
      if (asset.previewStatus === 'ready' && asset.previewRef) {
        finished = true;
        return;
      }
      if (
        asset.previewStatus !== 'processing' ||
        asset.previewClaimToken !== claimToken ||
        leaseExpired(asset.previewLeaseUntil, nowIso)
      ) return;
      const updated: Asset = {
        ...asset,
        previewStatus: result.status,
        previewRef: result.previewRef,
        previewErrorCode: result.errorCode,
        previewLeaseUntil: undefined,
        previewClaimToken: undefined,
        previewUpdatedAt: nowIso,
      };
      store.put(updated);
      finished = true;
    };
  });
  return finished;
}

export function completePreviewJob(
  assetId: string,
  claimToken: string,
  previewRef: string,
  now?: Date,
): Promise<boolean> {
  return finishPreviewJob(assetId, claimToken, { status: 'ready', previewRef }, now);
}

export async function renewPreviewJob(
  assetId: string,
  claimToken: string,
  now = new Date(),
): Promise<boolean> {
  const db = await openDb();
  const nowIso = now.toISOString();
  let renewed = false;
  await tx(db, STORES.assets, 'readwrite', (transaction) => {
    const store = transaction.objectStore(STORES.assets);
    const request = store.get(assetId);
    request.onsuccess = () => {
      const asset = request.result as Asset | undefined;
      if (!asset || asset.previewStatus !== 'processing' || asset.previewClaimToken !== claimToken || leaseExpired(asset.previewLeaseUntil, nowIso)) return;
      store.put({
        ...asset,
        previewLeaseUntil: new Date(now.getTime() + PREVIEW_LEASE_MS).toISOString(),
        previewUpdatedAt: nowIso,
      } satisfies Asset);
      renewed = true;
    };
  });
  return renewed;
}

export function failPreviewJob(
  assetId: string,
  claimToken: string,
  errorCode: string,
  now?: Date,
): Promise<boolean> {
  return finishPreviewJob(assetId, claimToken, { status: 'failed', errorCode }, now);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Permanently delete trashed records older than the retention window. */
export async function purgeExpiredTrash(
  retentionDays: number,
  now: Date = new Date(),
): Promise<{ recordIds: string[]; fileRecords: FileRecord[] }> {
  const safeDays = Math.max(1, Math.round(retentionDays));
  const cutoff = new Date(now.getTime() - safeDays * DAY_MS).toISOString();
  const expiredRecords = (await recordRepository.listTrashed()).filter((record) => record.trashedAt && record.trashedAt <= cutoff);
  const deletedFileRecords: FileRecord[] = [];
  for (const record of expiredRecords) {
    deletedFileRecords.push(...(await deleteRecordCascade(record.id)));
  }
  return { recordIds: expiredRecords.map((record) => record.id), fileRecords: deletedFileRecords };
}

/** Delete every record currently in trash. Active records are left untouched. */
export async function deleteAllTrashedRecords(): Promise<{ recordIds: string[]; fileRecords: FileRecord[] }> {
  const trashedRecords = await recordRepository.listTrashed();
  const deletedFileRecords: FileRecord[] = [];
  for (const record of trashedRecords) {
    deletedFileRecords.push(...(await deleteRecordCascade(record.id)));
  }
  return { recordIds: trashedRecords.map((record) => record.id), fileRecords: deletedFileRecords };
}

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
