import { describe, expect, it } from 'vitest';
import {
  createPromptTraceBackupZip,
  LEGACY_PROMPTTRACE_MANIFEST_PATH,
  parsePromptTraceBackupZip,
  promptTraceBackupMediaDownloadFilename,
  promptTraceBackupMediaPath,
  sanitizeBackupFileRecord,
  type PromptTraceBackupData,
} from '@/src/core/backup/archive';
import { createZip } from '@/src/core/backup/zip';
import type { FileRecord } from '@/src/core/domain/entities';

const v2Data: PromptTraceBackupData = {
  records: [
    { id: 'rec-1', title: 'Test record', createdAt: '2026-07-03T00:00:00Z', updatedAt: '2026-07-03T00:00:00Z' },
  ],
  assets: [
    { id: 'asset-1', recordId: 'rec-1', assetType: 'image', role: 'output', orderIndex: 0, capturedAt: '2026-07-03T00:00:00Z' },
  ],
  tags: [{ id: 'tag-1', recordId: 'rec-1', name: 'test' }],
  categories: [],
  media: [{ assetId: 'asset-1', recordId: 'rec-1', path: 'media/rec-1/asset-1.webp', mimeType: 'image/webp' }],
};

const v1Data: PromptTraceBackupData = {
  ...v2Data,
  fileRecords: [{
    id: 'file-1',
    assetId: 'asset-1',
    filename: 'image.png',
    downloadStatus: 'pending',
    deleteStatus: 'not_deleted',
    updatedAt: '2026-07-03T00:00:00Z',
  }],
  media: [{
    assetId: 'asset-1',
    fileRecordId: 'file-1',
    recordId: 'rec-1',
    path: 'media/rec-1/image.png',
    filename: 'image.png',
    mimeType: 'image/png',
    source: 'data-url',
  }],
};

async function createV1Zip(data: PromptTraceBackupData): Promise<Blob> {
  return createZip([
    {
      path: LEGACY_PROMPTTRACE_MANIFEST_PATH,
      data: JSON.stringify({
        format: 'prompttrace-backup',
        version: 1,
        exportedAt: '2026-07-03T00:00:00Z',
        counts: { records: data.records.length, assets: data.assets.length, mediaFiles: data.media.length },
      }),
    },
    { path: 'records.json', data: JSON.stringify(data) },
    { path: data.media[0].path, data: new Blob(['png-bytes'], { type: 'image/png' }) },
  ]);
}

describe('PrompTrace backup archive', () => {
  it('round-trips v2 metadata and media files with hash verification', async () => {
    const path = promptTraceBackupMediaPath(v2Data.media[0]);
    const zip = await createPromptTraceBackupZip(v2Data, new Map([[path, new Blob(['webp-bytes'], { type: 'image/webp' })]]));
    const parsed = await parsePromptTraceBackupZip(zip);

    expect(parsed.manifest.version).toBe(2);
    expect(parsed.data.records[0].title).toBe('Test record');
    expect(parsed.data.assets[0].previewRef).toBeUndefined();
    expect(parsed.data.fileRecords).toBeUndefined();
    expect(await parsed.files.get(path)?.text()).toBe('webp-bytes');
  });

  it('strips Data URL metadata from a v2 export', async () => {
    const zip = await createPromptTraceBackupZip({
      ...v2Data,
      assets: [{ ...v2Data.assets[0], previewRef: 'data:image/webp;base64,AA==' }],
    }, new Map([[v2Data.media[0].path, new Blob(['webp-bytes'], { type: 'image/webp' })]]));
    const parsed = await parsePromptTraceBackupZip(zip);
    expect(parsed.data.assets[0].previewRef).toBeUndefined();
  });

  it('strips local download state from legacy file records', () => {
    const fileRecord: FileRecord = {
      id: 'file-1',
      assetId: 'asset-1',
      filename: 'image.png',
      localPath: 'C:/Users/me/Downloads/PrompTrace/rec-1/image.png',
      downloadId: 123,
      downloadStatus: 'completed',
      deleteStatus: 'not_deleted',
      updatedAt: '2026-07-03T00:00:00Z',
    };
    const sanitized = sanitizeBackupFileRecord(fileRecord);
    expect(sanitized.localPath).toBeUndefined();
    expect(sanitized.downloadId).toBeUndefined();
    expect(sanitized.downloadStatus).toBe('pending');
  });

  it('accepts legacy v1 PromptTrace backup manifests', async () => {
    const parsed = await parsePromptTraceBackupZip(await createV1Zip(v1Data));
    expect(parsed.manifest.version).toBe(1);
    expect(parsed.data.fileRecords).toHaveLength(1);
  });

  it('rejects tampered v1 backup media filenames before import can write records', async () => {
    const tampered: PromptTraceBackupData = {
      ...v1Data,
      media: [{ ...v1Data.media[0], filename: '../image.png', path: 'media/rec-1/../image.png' }],
    };
    await expect(parsePromptTraceBackupZip(await createV1Zip(tampered))).rejects.toThrow(
      'PROMPTTRACE_BACKUP_INVALID_MEDIA_FILENAME',
    );
  });

  it('rejects v2 media hash mismatches', async () => {
    const path = promptTraceBackupMediaPath(v2Data.media[0]);
    const zip = await createPromptTraceBackupZip(v2Data, new Map([[path, new Blob(['webp-bytes'], { type: 'image/webp' })]]));
    const files = new Map<string, Blob>();
    // Rebuild the archive with a valid manifest/metadata and altered media.
    const parsed = await parsePromptTraceBackupZip(zip);
    const tampered = new Blob(['different-bytes'], { type: 'image/webp' });
    files.set('promptrace-manifest.json', new Blob([JSON.stringify(parsed.manifest)]));
    files.set('records.json', new Blob([JSON.stringify(parsed.data)]));
    files.set(path, tampered);
    await expect(parsePromptTraceBackupZip(await createZip(Array.from(files, ([entryPath, data]) => ({ path: entryPath, data }))))).rejects.toThrow(
      'PROMPTTRACE_BACKUP_MEDIA_HASH_MISMATCH',
    );
  });

  it('keeps the legacy download filename helper isolated to v1 parsing', () => {
    expect(promptTraceBackupMediaDownloadFilename(v1Data.media[0])).toBe('PrompTrace/rec-1/image.png');
  });
});
