// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { DB_NAME, LEGACY_DB_NAME, resetDbCache, STORES } from '@/src/storage/db';
import {
  assetRepository,
  categoryRepository,
  deleteRecordCascade,
  purgeExpiredTrash,
  fileRecordRepository,
  recordRepository,
  tagRepository,
} from '@/src/storage/repositories';
import { commitSessionToLibrary, downloadPathFor, isDownloadableUrl } from '@/src/storage/commitSession';
import { BUILTIN_CATEGORY_DEFAULTS, seedDefaults } from '@/src/storage/seed';
import type { PendingAsset } from '@/src/core/domain/entities';

const pending = (over: Partial<PendingAsset>): PendingAsset => ({
  id: crypto.randomUUID(),
  assetType: 'text',
  role: 'input',
  textContent: 'hello',
  pageUrl: 'https://page.test',
  pageTitle: 'Page',
  capturedAt: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  // Fresh in-memory IndexedDB per test.
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
});

describe('seed', () => {
  it('migrates records from the legacy PromptTrace IndexedDB name', async () => {
    const legacyDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(LEGACY_DB_NAME, 1);
      req.onupgradeneeded = () => {
        for (const store of Object.values(STORES)) req.result.createObjectStore(store, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = legacyDb.transaction(STORES.libraryRecords, 'readwrite');
      transaction.objectStore(STORES.libraryRecords).put({
        id: 'legacy-record',
        title: 'Legacy record',
        createdAt: '2026-07-04T00:00:00Z',
        updatedAt: '2026-07-04T00:00:00Z',
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    legacyDb.close();

    resetDbCache();
    const records = await recordRepository.list();

    expect(DB_NAME).toBe('promptrace');
    expect(records.map((record) => record.id)).toContain('legacy-record');
  });

  it('seeds built-in categories once', async () => {
    await seedDefaults();
    await seedDefaults();
    const cats = await categoryRepository.list();
    expect(cats.filter((c) => c.isBuiltin)).toHaveLength(BUILTIN_CATEGORY_DEFAULTS.length);
    expect(cats.map((c) => c.name)).toContain('生文');
  });
});

describe('commit session', () => {
  it('writes record + text assets to IndexedDB', async () => {
    const result = await commitSessionToLibrary(
      [
        pending({ role: 'input', textContent: 'the prompt' }),
        pending({ role: 'output', textContent: 'the answer' }),
      ],
      { categoryId: null },
    );
    const record = await recordRepository.get(result.record.id);
    expect(record?.sourcePageUrl).toBe('https://page.test');
    const assets = await assetRepository.byRecord(result.record.id);
    expect(assets).toHaveLength(2);
    expect(result.pendingDownloads).toHaveLength(0);
  });

  it('merges same-role text captures into one text asset', async () => {
    const result = await commitSessionToLibrary(
      [
        pending({ role: 'input', textContent: 'A 文' }),
        pending({ role: 'input', textContent: 'B 文' }),
        pending({ role: 'negative', textContent: '不要出現浮水印' }),
      ],
      { categoryId: null },
    );

    const assets = await assetRepository.byRecord(result.record.id);
    expect(assets).toHaveLength(2);
    expect(assets.find((asset) => asset.role === 'input')?.textContent).toBe('A 文\n\nB 文');
    expect(assets.find((asset) => asset.role === 'negative')?.textContent).toBe('不要出現浮水印');
  });

  it('creates pending FileRecord for downloadable media', async () => {
    const result = await commitSessionToLibrary(
      [pending({ assetType: 'image', textContent: undefined, originalUrl: 'https://x.test/a.png', role: 'input' })],
      {},
    );
    expect(result.pendingDownloads).toHaveLength(1);
    const { fileRecord, url } = result.pendingDownloads[0];
    expect(url).toBe('https://x.test/a.png');
    expect(fileRecord.downloadStatus).toBe('pending');
    expect(downloadPathFor(result.record.id, fileRecord)).toBe(`PrompTrace/${result.record.id}/${fileRecord.filename}`);
    const stored = await fileRecordRepository.get(fileRecord.id);
    expect(stored?.assetId).toBe(result.assets[0].id);
  });

  it('plans a compressed WebP download instead of the original image', async () => {
    const result = await commitSessionToLibrary(
      [pending({ assetType: 'image', textContent: undefined, originalUrl: 'https://x.test/large.png', role: 'output' })],
      {},
      { image: 'webp', video: 'original' },
    );

    expect(result.pendingDownloads).toHaveLength(1);
    expect(result.pendingDownloads[0].mode).toBe('image-webp');
    expect(result.pendingDownloads[0].fileRecord.filename).toMatch(/-preview\.webp$/);
    expect(result.pendingDownloads[0].fileRecord.mimeType).toBe('image/webp');
    expect(result.pendingPreviews).toEqual([
      expect.objectContaining({ assetId: result.assets[0].id, assetType: 'image' }),
    ]);
  });

  it('keeps only a GIF preview plan when original video downloads are disabled', async () => {
    const result = await commitSessionToLibrary(
      [pending({ assetType: 'video', textContent: undefined, originalUrl: 'https://x.test/large.mp4', role: 'output' })],
      {},
      { image: 'original', video: 'preview-only' },
    );

    expect(result.pendingDownloads).toHaveLength(0);
    expect(result.pendingPreviews).toEqual([
      expect.objectContaining({ assetId: result.assets[0].id, assetType: 'video' }),
    ]);
    expect(await fileRecordRepository.byAsset(result.assets[0].id)).toHaveLength(0);
  });

  it('keeps data-url images local without starting a browser download', async () => {
    const dataUrl = `data:image/png;base64,${'A'.repeat(180)}`;
    const result = await commitSessionToLibrary(
      [pending({ assetType: 'image', textContent: undefined, originalUrl: dataUrl, role: 'output' })],
      {},
    );

    expect(result.pendingDownloads).toHaveLength(0);
    expect(result.sourceOnlyAssets).toHaveLength(1);
    expect(result.assets[0].originalUrl).toBe(dataUrl);
    expect(result.assets[0].previewRef).toBe(dataUrl);
    expect(await fileRecordRepository.byAsset(result.assets[0].id)).toHaveLength(0);
  });

  it('blob-url video falls back to source-only without failing the record', async () => {
    const result = await commitSessionToLibrary(
      [
        pending({ role: 'input', textContent: 'prompt' }),
        pending({
          assetType: 'video',
          textContent: undefined,
          originalUrl: 'blob:https://x.test/123',
          role: 'output',
        }),
      ],
      {},
    );
    expect(result.pendingDownloads).toHaveLength(0);
    expect(result.sourceOnlyAssets).toHaveLength(1);
    // The record and both assets still exist.
    expect(await recordRepository.get(result.record.id)).toBeTruthy();
    expect(await assetRepository.byRecord(result.record.id)).toHaveLength(2);
  });

  it('isDownloadableUrl only allows remote media downloads', () => {
    expect(isDownloadableUrl('https://x.test/a.mp4')).toBe(true);
    expect(isDownloadableUrl('data:image/png;base64,xx')).toBe(false);
    expect(isDownloadableUrl('blob:https://x.test/1')).toBe(false);
    expect(isDownloadableUrl('mediasource:whatever')).toBe(false);
  });
});

describe('download status transitions', () => {
  it('failure marks FileRecord failed without touching the asset', async () => {
    const result = await commitSessionToLibrary(
      [pending({ assetType: 'image', textContent: undefined, originalUrl: 'https://x.test/a.png', role: 'input' })],
      {},
    );
    const fr = result.pendingDownloads[0].fileRecord;
    await fileRecordRepository.save({ ...fr, downloadStatus: 'failed', updatedAt: new Date().toISOString() });
    expect((await fileRecordRepository.get(fr.id))?.downloadStatus).toBe('failed');
    expect(await assetRepository.get(result.assets[0].id)).toBeTruthy();
  });
});

describe('trash and delete record with file linkage', () => {
  it('soft-deletes records into trash and restores them without touching assets', async () => {
    const result = await commitSessionToLibrary(
      [pending({ role: 'input', textContent: 'temporary prompt' })],
      {},
    );

    await recordRepository.trash(result.record.id, '2026-07-01T00:00:00.000Z');
    expect(await recordRepository.listActive()).toHaveLength(0);
    expect((await recordRepository.listTrashed()).map((record) => record.id)).toEqual([result.record.id]);
    expect(await assetRepository.byRecord(result.record.id)).toHaveLength(1);

    await recordRepository.restore(result.record.id);
    expect(await recordRepository.listActive()).toHaveLength(1);
    expect(await recordRepository.listTrashed()).toHaveLength(0);
  });

  it('purges expired trash records by retention window', async () => {
    const oldRecord = await commitSessionToLibrary(
      [pending({ role: 'input', textContent: 'old' })],
      {},
    );
    const freshRecord = await commitSessionToLibrary(
      [pending({ role: 'input', textContent: 'fresh' })],
      {},
    );
    await recordRepository.trash(oldRecord.record.id, '2026-07-01T00:00:00.000Z');
    await recordRepository.trash(freshRecord.record.id, '2026-07-09T00:00:00.000Z');

    const purged = await purgeExpiredTrash(7, new Date('2026-07-09T00:00:01.000Z'));

    expect(purged.recordIds).toEqual([oldRecord.record.id]);
    expect(await recordRepository.get(oldRecord.record.id)).toBeUndefined();
    expect(await recordRepository.get(freshRecord.record.id)).toBeTruthy();
    expect((await recordRepository.listTrashed()).map((record) => record.id)).toEqual([freshRecord.record.id]);
  });

  it('cascade removes record, assets, file records and tags, returning file records', async () => {
    const result = await commitSessionToLibrary(
      [
        pending({ role: 'input', textContent: 'p' }),
        pending({ assetType: 'image', textContent: undefined, originalUrl: 'https://x.test/a.png', role: 'output' }),
      ],
      {},
    );
    await tagRepository.save({ id: 't1', recordId: result.record.id, name: 'tag' });

    const files = await deleteRecordCascade(result.record.id);
    expect(files).toHaveLength(1);
    expect(await recordRepository.get(result.record.id)).toBeUndefined();
    expect(await assetRepository.byRecord(result.record.id)).toHaveLength(0);
    expect(await fileRecordRepository.get(files[0].id)).toBeUndefined();
    expect(await tagRepository.byRecord(result.record.id)).toHaveLength(0);
  });
});

describe('category / preset repositories', () => {
  it('supports custom multi-level categories', async () => {
    const now = new Date().toISOString();
    await categoryRepository.save({
      id: 'p',
      parentId: null,
      name: '工程',
      isBuiltin: false,
      isActive: true,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    });
    await categoryRepository.save({
      id: 'c',
      parentId: 'p',
      name: 'Code Review',
      isBuiltin: false,
      isActive: true,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    });
    expect((await categoryRepository.children('p')).map((c) => c.name)).toEqual(['Code Review']);
  });
});
