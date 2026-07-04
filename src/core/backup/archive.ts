import type { Asset, FileRecord, LibraryRecord, RecordCategory, Tag } from '../domain/entities';
import { createZip, readZip, type ZipEntry } from './zip';

export const PROMPTTRACE_BACKUP_VERSION = 1;
export const PROMPTTRACE_MANIFEST_PATH = 'promptrace-manifest.json';
export const LEGACY_PROMPTTRACE_MANIFEST_PATH = 'prompttrace-manifest.json';
export const PROMPTTRACE_RECORDS_PATH = 'records.json';
const PROMPTTRACE_DOWNLOAD_ROOT = 'PrompTrace';
const PROMPTTRACE_MEDIA_PATH_ROOT = 'media';
const BACKUP_PATH_SEGMENT_FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/;
const WINDOWS_RESERVED_FILENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export type BackupMediaEntry = {
  assetId: string;
  fileRecordId: string;
  recordId: string;
  path: string;
  filename: string;
  mimeType?: string;
  source: 'original' | 'preview' | 'data-url';
};

export type PromptTraceBackupData = {
  records: LibraryRecord[];
  assets: Asset[];
  fileRecords: FileRecord[];
  tags: Tag[];
  categories: RecordCategory[];
  media: BackupMediaEntry[];
};

export type PromptTraceBackupManifest = {
  format: 'promptrace-backup' | 'prompttrace-backup';
  version: typeof PROMPTTRACE_BACKUP_VERSION;
  exportedAt: string;
  counts: {
    records: number;
    assets: number;
    mediaFiles: number;
  };
};

export type ParsedPromptTraceBackup = {
  manifest: PromptTraceBackupManifest;
  data: PromptTraceBackupData;
  files: Map<string, Blob>;
};

export function backupFilename(date = new Date()): string {
  return `promptrace-backup-${date.toISOString().slice(0, 10)}.zip`;
}

function assertSafeBackupPathSegment(value: string, errorCode: string): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    value === '.' ||
    value === '..' ||
    BACKUP_PATH_SEGMENT_FORBIDDEN.test(value) ||
    WINDOWS_RESERVED_FILENAME.test(value) ||
    /[. ]$/.test(value)
  ) {
    throw new Error(errorCode);
  }
}

export function promptTraceBackupMediaDownloadFilename(entry: BackupMediaEntry): string {
  assertSafeBackupPathSegment(entry.recordId, 'PROMPTTRACE_BACKUP_INVALID_MEDIA_RECORD_ID');
  assertSafeBackupPathSegment(entry.filename, 'PROMPTTRACE_BACKUP_INVALID_MEDIA_FILENAME');
  return `${PROMPTTRACE_DOWNLOAD_ROOT}/${entry.recordId}/${entry.filename}`;
}

function validatePromptTraceBackupData(data: PromptTraceBackupData): void {
  if (
    !Array.isArray(data.records) ||
    !Array.isArray(data.assets) ||
    !Array.isArray(data.fileRecords) ||
    !Array.isArray(data.media)
  ) {
    throw new Error('PROMPTTRACE_BACKUP_INVALID_RECORDS');
  }
  for (const entry of data.media) {
    promptTraceBackupMediaDownloadFilename(entry);
    const expectedPath = `${PROMPTTRACE_MEDIA_PATH_ROOT}/${entry.recordId}/${entry.filename}`;
    if (entry.path !== expectedPath) throw new Error('PROMPTTRACE_BACKUP_INVALID_MEDIA_PATH');
  }
}

export async function createPromptTraceBackupZip(data: PromptTraceBackupData, mediaFiles: Map<string, Blob>): Promise<Blob> {
  const manifest: PromptTraceBackupManifest = {
    format: 'promptrace-backup',
    version: PROMPTTRACE_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      records: data.records.length,
      assets: data.assets.length,
      mediaFiles: mediaFiles.size,
    },
  };
  const entries: ZipEntry[] = [
    {
      path: PROMPTTRACE_MANIFEST_PATH,
      data: JSON.stringify(manifest, null, 2),
    },
    {
      path: PROMPTTRACE_RECORDS_PATH,
      data: JSON.stringify(data, null, 2),
    },
  ];
  for (const [path, file] of mediaFiles) entries.push({ path, data: file });
  return createZip(entries);
}

export async function parsePromptTraceBackupZip(file: Blob): Promise<ParsedPromptTraceBackup> {
  const files = await readZip(file);
  const manifestFile = files.get(PROMPTTRACE_MANIFEST_PATH) ?? files.get(LEGACY_PROMPTTRACE_MANIFEST_PATH);
  const recordsFile = files.get(PROMPTTRACE_RECORDS_PATH);
  if (!manifestFile || !recordsFile) throw new Error('PROMPTTRACE_BACKUP_MISSING_METADATA');

  const manifest = JSON.parse(await manifestFile.text()) as PromptTraceBackupManifest;
  if (
    (manifest.format !== 'promptrace-backup' && manifest.format !== 'prompttrace-backup') ||
    manifest.version !== PROMPTTRACE_BACKUP_VERSION
  ) {
    throw new Error('PROMPTTRACE_BACKUP_UNSUPPORTED_VERSION');
  }
  const data = JSON.parse(await recordsFile.text()) as PromptTraceBackupData;
  validatePromptTraceBackupData(data);
  return { manifest, data, files };
}

export function sanitizeBackupFileRecord(fileRecord: FileRecord): FileRecord {
  return {
    ...fileRecord,
    localPath: undefined,
    downloadId: undefined,
    downloadStatus: fileRecord.downloadStatus === 'not_required' ? 'not_required' : 'pending',
    updatedAt: new Date().toISOString(),
  };
}
