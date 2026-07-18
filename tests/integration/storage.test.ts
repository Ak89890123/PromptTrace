// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { DB_NAME, LEGACY_DB_NAME, resetDbCache, STORES } from '@/src/storage/db';
import {
  assetRepository,
  claimNextPreviewJob,
  categoryRepository,
  completePreviewJob,
  deleteAllTrashedRecords,
  deleteRecordCascade,
  failPreviewJob,
  purgeExpiredTrash,
  fileRecordRepository,
  recordRepository,
  tagRepository,
  renewPreviewJob,
} from '@/src/storage/repositories';
import { commitSessionToLibrary, isDownloadableUrl } from '@/src/storage/commitSession';
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

  it('creates a durable preview job without a FileRecord or download plan', async () => {
    const result = await commitSessionToLibrary(
      [pending({ assetType: 'image', textContent: undefined, originalUrl: 'https://x.test/a.png', role: 'input' })],
      {},
      'high',
    );
    expect(result.pendingPreviews).toHaveLength(1);
    expect(result.assets[0].previewStatus).toBe('pending');
    expect(result.assets[0].previewQuality).toBe('high');
    expect(await fileRecordRepository.byAsset(result.assets[0].id)).toHaveLength(0);
    expect('pendingDownloads' in result).toBe(false);
  });

  it('uses the same durable preview job shape for remote images', async () => {
    const result = await commitSessionToLibrary(
      [pending({ assetType: 'image', textContent: undefined, originalUrl: 'https://x.test/large.png', role: 'output' })],
      {},
    );

    expect(result.assets[0].previewStatus).toBe('pending');
    expect(result.pendingPreviews).toEqual([
      expect.objectContaining({ assetId: result.assets[0].id, assetType: 'image' }),
    ]);
  });

  it('keeps only a GIF preview plan for videos', async () => {
    const result = await commitSessionToLibrary(
      [pending({ assetType: 'video', textContent: undefined, originalUrl: 'https://x.test/large.mp4', role: 'output' })],
      {},
    );

    expect(result.pendingPreviews).toEqual([
      expect.objectContaining({ assetId: result.assets[0].id, assetType: 'video' }),
    ]);
    expect(await fileRecordRepository.byAsset(result.assets[0].id)).toHaveLength(0);
  });

  it('persists only a canonical preview for data-url images', async () => {
    const dataUrl = 'data:image/png;base64,AAAA';
    const previewRef = 'data:image/webp;base64,AAAA';
    const result = await commitSessionToLibrary(
      [pending({ assetType: 'image', textContent: undefined, originalUrl: dataUrl, previewRef, role: 'output' })],
      {},
    );

    expect(result.sourceOnlyAssets).toHaveLength(0);
    expect(result.assets[0].originalUrl).toBeUndefined();
    expect(result.assets[0].previewRef).toBe(previewRef);
    expect(result.assets[0].previewStatus).toBe('ready');
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

describe('preview job transitions', () => {
  it('claims and completes a pending preview with a fenced token', async () => {
    const result = await commitSessionToLibrary(
      [pending({ assetType: 'video', textContent: undefined, originalUrl: 'https://x.test/a.mp4', role: 'output' })],
      {},
    );
    const claim = await claimNextPreviewJob(new Date('2026-07-10T00:00:00.000Z'));
    expect(claim?.asset.id).toBe(result.assets[0].id);
    expect(claim?.asset.previewStatus).toBe('processing');
    expect(await renewPreviewJob(result.assets[0].id, claim!.claimToken, new Date('2026-07-10T00:00:20.000Z'))).toBe(true);
    const claimedAt = new Date('2026-07-10T00:00:00.000Z');
    expect(await completePreviewJob(result.assets[0].id, 'stale-token', 'data:image/gif;base64,AAAA', claimedAt)).toBe(false);
    expect(await completePreviewJob(result.assets[0].id, claim!.claimToken, 'data:image/gif;base64,AAAA', claimedAt)).toBe(true);
    expect((await assetRepository.get(result.assets[0].id))?.previewStatus).toBe('ready');
  });

  it('marks a claimed preview failed and does not auto-retry it', async () => {
    const result = await commitSessionToLibrary(
      [pending({ assetType: 'image', textContent: undefined, originalUrl: 'https://x.test/a.png', role: 'output' })],
      {},
    );
    const claim = await claimNextPreviewJob();
    expect(await failPreviewJob(result.assets[0].id, claim!.claimToken, 'MEDIA_PREVIEW_FETCH_404')).toBe(true);
    expect((await assetRepository.get(result.assets[0].id))?.previewStatus).toBe('failed');
    expect(await claimNextPreviewJob()).toBeUndefined();
  });

  it('keeps a failed legacy FileRecord readable without coupling it to new capture', async () => {
    const result = await commitSessionToLibrary(
      [pending({ assetType: 'image', textContent: undefined, originalUrl: 'https://x.test/a.png', role: 'input' })],
      {},
    );
    const fr = {
      id: 'legacy-file',
      assetId: result.assets[0].id,
      filename: 'legacy.png',
      downloadStatus: 'pending' as const,
      deleteStatus: 'not_deleted' as const,
      updatedAt: new Date().toISOString(),
    };
    await fileRecordRepository.save(fr);
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

  it('deletes all trashed records without touching active records', async () => {
    const trashed = await commitSessionToLibrary([pending({ role: 'input', textContent: 'trash' })], {});
    const active = await commitSessionToLibrary([pending({ role: 'input', textContent: 'keep' })], {});
    await recordRepository.trash(trashed.record.id, '2026-07-01T00:00:00.000Z');

    const deleted = await deleteAllTrashedRecords();

    expect(deleted.recordIds).toEqual([trashed.record.id]);
    expect(await recordRepository.get(trashed.record.id)).toBeUndefined();
    expect(await recordRepository.get(active.record.id)).toBeTruthy();
    expect(await assetRepository.byRecord(trashed.record.id)).toHaveLength(0);
  });

  it('cascade removes record, assets, legacy file records and tags without file deletion', async () => {
    const result = await commitSessionToLibrary(
      [
        pending({ role: 'input', textContent: 'p' }),
        pending({ assetType: 'image', textContent: undefined, originalUrl: 'https://x.test/a.png', role: 'output' }),
      ],
      {},
    );
    await tagRepository.save({ id: 't1', recordId: result.record.id, name: 'tag' });

    await fileRecordRepository.save({
      id: 'legacy-file',
      assetId: result.assets[1].id,
      filename: 'legacy.png',
      downloadStatus: 'completed',
      deleteStatus: 'not_deleted',
      downloadId: 123,
      updatedAt: new Date().toISOString(),
    });
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
