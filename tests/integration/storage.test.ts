// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { resetDbCache } from '@/src/storage/db';
import {
  assetRepository,
  categoryRepository,
  deleteRecordCascade,
  fileRecordRepository,
  modelPresetRepository,
  recordRepository,
  tagRepository,
} from '@/src/storage/repositories';
import { commitSessionToLibrary, downloadPathFor, isDownloadableUrl } from '@/src/storage/commitSession';
import { seedDefaults } from '@/src/storage/seed';
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
  it('seeds built-in categories and presets once', async () => {
    await seedDefaults();
    await seedDefaults();
    const cats = await categoryRepository.list();
    const presets = await modelPresetRepository.list();
    expect(cats.filter((c) => c.isBuiltin)).toHaveLength(7);
    expect(cats.map((c) => c.name)).toContain('生文');
    expect(presets.map((p) => p.modelName)).toContain('Claude');
  });
});

describe('commit session', () => {
  it('writes record + text assets to IndexedDB', async () => {
    const result = await commitSessionToLibrary(
      [
        pending({ role: 'input', textContent: 'the prompt' }),
        pending({ role: 'output', textContent: 'the answer' }),
      ],
      { categoryId: null, modelLabel: 'Unknown' },
    );
    const record = await recordRepository.get(result.record.id);
    expect(record?.modelLabel).toBe('Unknown');
    expect(record?.sourcePageUrl).toBe('https://page.test');
    const assets = await assetRepository.byRecord(result.record.id);
    expect(assets).toHaveLength(2);
    expect(result.pendingDownloads).toHaveLength(0);
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
    expect(downloadPathFor(result.record.id, fileRecord)).toBe(
      `PromptTrace/${result.record.id}/${fileRecord.filename}`,
    );
    const stored = await fileRecordRepository.get(fileRecord.id);
    expect(stored?.assetId).toBe(result.assets[0].id);
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

  it('isDownloadableUrl rejects blob/mediasource', () => {
    expect(isDownloadableUrl('https://x.test/a.mp4')).toBe(true);
    expect(isDownloadableUrl('data:image/png;base64,xx')).toBe(true);
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

describe('delete record with file linkage', () => {
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
