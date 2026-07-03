import { describe, expect, it } from 'vitest';
import {
  createPromptTraceBackupZip,
  parsePromptTraceBackupZip,
  sanitizeBackupFileRecord,
  type PromptTraceBackupData,
} from '@/src/core/backup/archive';
import type { FileRecord } from '@/src/core/domain/entities';

const data: PromptTraceBackupData = {
  records: [
    {
      id: 'rec-1',
      title: 'Test record',
      createdAt: '2026-07-03T00:00:00Z',
      updatedAt: '2026-07-03T00:00:00Z',
    },
  ],
  assets: [
    {
      id: 'asset-1',
      recordId: 'rec-1',
      assetType: 'image',
      role: 'output',
      orderIndex: 0,
      capturedAt: '2026-07-03T00:00:00Z',
    },
  ],
  fileRecords: [
    {
      id: 'file-1',
      assetId: 'asset-1',
      filename: 'image.png',
      downloadStatus: 'pending',
      deleteStatus: 'not_deleted',
      updatedAt: '2026-07-03T00:00:00Z',
    },
  ],
  tags: [{ id: 'tag-1', recordId: 'rec-1', name: 'test' }],
  categories: [],
  modelPresets: [],
  media: [
    {
      assetId: 'asset-1',
      fileRecordId: 'file-1',
      recordId: 'rec-1',
      path: 'media/rec-1/image.png',
      filename: 'image.png',
      mimeType: 'image/png',
      source: 'data-url',
    },
  ],
};

describe('PromptTrace backup archive', () => {
  it('round-trips metadata and media files through a standard zip', async () => {
    const media = new Map<string, Blob>([
      ['media/rec-1/image.png', new Blob(['png-bytes'], { type: 'image/png' })],
    ]);

    const zip = await createPromptTraceBackupZip(data, media);
    const parsed = await parsePromptTraceBackupZip(zip);

    expect(parsed.manifest.format).toBe('prompttrace-backup');
    expect(parsed.manifest.counts.records).toBe(1);
    expect(parsed.data.records[0].title).toBe('Test record');
    expect(await parsed.files.get('media/rec-1/image.png')?.text()).toBe('png-bytes');
  });

  it('strips local download state from file records for portable backups', () => {
    const fileRecord: FileRecord = {
      id: 'file-1',
      assetId: 'asset-1',
      filename: 'image.png',
      localPath: 'C:/Users/me/Downloads/PromptTrace/rec-1/image.png',
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
});

