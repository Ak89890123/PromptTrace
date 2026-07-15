// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { Asset, LibraryRecord } from '@/src/core/domain/entities';
import type { ParsedPromptTraceBackup } from '@/src/core/backup/archive';
import { assetRepository, recordRepository } from '@/src/storage/repositories';
import { resetDbCache } from '@/src/storage/db';
import { prepareBackupRestore, restorePreparedBackup } from '@/src/storage/backupRestore';

const record: LibraryRecord = {
  id: 'record-1',
  title: 'Restored',
  createdAt: '2026-07-10T00:00:00Z',
  updatedAt: '2026-07-10T00:00:00Z',
};

const asset: Asset = {
  id: 'asset-1',
  recordId: record.id,
  assetType: 'image',
  role: 'output',
  orderIndex: 0,
  capturedAt: record.createdAt,
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
});

describe('backup restore', () => {
  it('canonicalizes media before a single metadata transaction and never writes FileRecords', async () => {
    const parsed = {
      manifest: { format: 'prompttrace-backup', version: 1, exportedAt: record.createdAt, counts: { records: 1, assets: 1, mediaFiles: 0 } },
      data: {
        records: [record],
        assets: [{ ...asset, originalUrl: 'data:image/png;base64,AA==' }],
        tags: [],
        categories: [],
        fileRecords: [],
        media: [],
      },
      files: new Map(),
    } as ParsedPromptTraceBackup;
    const prepared = await prepareBackupRestore(parsed, async () => 'data:image/webp;base64,AA==');

    expect(prepared.data.assets[0].originalUrl).toBeUndefined();
    expect(prepared.data.assets[0].previewRef).toBe('data:image/webp;base64,AA==');
    await restorePreparedBackup(prepared.data);
    expect(await recordRepository.get(record.id)).toBeTruthy();
    expect((await assetRepository.get(asset.id))?.previewStatus).toBe('ready');
  });

  it('aborts duplicate restore IDs without overwriting existing records', async () => {
    await restorePreparedBackup({ records: [record], assets: [asset], tags: [], categories: [] });
    await expect(restorePreparedBackup({ records: [record], assets: [asset], tags: [], categories: [] })).rejects.toThrow(
      'PROMPTTRACE_RESTORE_ID_CONFLICT',
    );
    expect((await recordRepository.list()).map((item) => item.id)).toEqual([record.id]);
  });

  it('treats a declared but missing archive media file as fatal', async () => {
    const parsed = {
      manifest: { format: 'prompttrace-backup', version: 1, exportedAt: record.createdAt, counts: { records: 1, assets: 1, mediaFiles: 1 } },
      data: {
        records: [record],
        assets: [asset],
        tags: [],
        categories: [],
        fileRecords: [{ id: 'file-1', assetId: asset.id, filename: 'image.png', downloadStatus: 'pending', deleteStatus: 'not_deleted', updatedAt: record.createdAt }],
        media: [{ assetId: asset.id, fileRecordId: 'file-1', recordId: record.id, path: 'media/record-1/image.png', filename: 'image.png', source: 'preview' }],
      },
      files: new Map(),
    } as ParsedPromptTraceBackup;
    await expect(prepareBackupRestore(parsed, async () => 'data:image/webp;base64,AA==')).rejects.toThrow(
      'PROMPTTRACE_RESTORE_MEDIA_FATAL',
    );
  });
});
