import { describe, expect, it } from 'vitest';
import {
  createPromptTraceBackupZip,
  LEGACY_PROMPTTRACE_MANIFEST_PATH,
  PROMPTTRACE_BACKUP_VERSION,
  PROMPTTRACE_MANIFEST_PATH,
  PROMPTTRACE_RECORDS_PATH,
  parsePromptTraceBackupZip,
  promptTraceBackupMediaDownloadFilename,
  sanitizeBackupFileRecord,
  type PromptTraceBackupData,
} from '@/src/core/backup/archive';
import { createZip } from '@/src/core/backup/zip';
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

async function createTamperedBackupZip(tamperedData: PromptTraceBackupData): Promise<Blob> {
  return createZip([
    {
      path: PROMPTTRACE_MANIFEST_PATH,
      data: JSON.stringify({
        format: 'promptrace-backup',
        version: PROMPTTRACE_BACKUP_VERSION,
        exportedAt: '2026-07-03T00:00:00Z',
        counts: {
          records: tamperedData.records.length,
          assets: tamperedData.assets.length,
          mediaFiles: tamperedData.media.length,
        },
      }),
    },
    {
      path: PROMPTTRACE_RECORDS_PATH,
      data: JSON.stringify(tamperedData),
    },
    {
      path: data.media[0].path,
      data: new Blob(['png-bytes'], { type: 'image/png' }),
    },
  ]);
}

describe('PrompTrace backup archive', () => {
  it('round-trips metadata and media files through a standard zip', async () => {
    const media = new Map<string, Blob>([
      ['media/rec-1/image.png', new Blob(['png-bytes'], { type: 'image/png' })],
    ]);

    const zip = await createPromptTraceBackupZip(data, media);
    const parsed = await parsePromptTraceBackupZip(zip);

    expect(parsed.manifest.format).toBe('promptrace-backup');
    expect(parsed.manifest.counts.records).toBe(1);
    expect(parsed.data.records[0].title).toBe('Test record');
    expect(await parsed.files.get('media/rec-1/image.png')?.text()).toBe('png-bytes');
  });

  it('strips local download state from file records for portable backups', () => {
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

  it('builds a Chrome download filename from validated media metadata', () => {
    expect(promptTraceBackupMediaDownloadFilename(data.media[0])).toBe('PrompTrace/rec-1/image.png');
  });

  it('accepts legacy PromptTrace backup manifests', async () => {
    const zip = await createZip([
      {
        path: LEGACY_PROMPTTRACE_MANIFEST_PATH,
        data: JSON.stringify({
          format: 'prompttrace-backup',
          version: PROMPTTRACE_BACKUP_VERSION,
          exportedAt: '2026-07-03T00:00:00Z',
          counts: {
            records: data.records.length,
            assets: data.assets.length,
            mediaFiles: data.media.length,
          },
        }),
      },
      {
        path: PROMPTTRACE_RECORDS_PATH,
        data: JSON.stringify(data),
      },
      {
        path: data.media[0].path,
        data: new Blob(['png-bytes'], { type: 'image/png' }),
      },
    ]);

    const parsed = await parsePromptTraceBackupZip(zip);

    expect(parsed.manifest.format).toBe('prompttrace-backup');
  });

  it('rejects tampered backup media filenames before import can write records', async () => {
    const tamperedData: PromptTraceBackupData = {
      ...data,
      media: [
        {
          ...data.media[0],
          filename: '../image.png',
          path: 'media/rec-1/../image.png',
        },
      ],
    };

    await expect(parsePromptTraceBackupZip(await createTamperedBackupZip(tamperedData))).rejects.toThrow(
      'PROMPTTRACE_BACKUP_INVALID_MEDIA_FILENAME',
    );
  });

  it('rejects tampered backup media paths that do not match their metadata', async () => {
    const tamperedData: PromptTraceBackupData = {
      ...data,
      media: [
        {
          ...data.media[0],
          path: 'media/other-record/image.png',
        },
      ],
    };

    await expect(parsePromptTraceBackupZip(await createTamperedBackupZip(tamperedData))).rejects.toThrow(
      'PROMPTTRACE_BACKUP_INVALID_MEDIA_PATH',
    );
  });
});
